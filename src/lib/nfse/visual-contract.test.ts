import { describe, it, expect, vi } from 'vitest'
import { validateVisualNfse, VISUAL_NFSE_JSON_SCHEMA } from './visual-contract'
import { visualFixture } from './fixtures/visual'
import { danfseFixture } from './fixtures/danfse-v2'
import { classifyFiscalImage, extractNfseVisual } from './openai-visual.server'
import { probeNfsePdf } from './pdf-dispatcher.server'
import { prepareNfsePersistence } from './persistence'
const bytes = Buffer.from('synthetic PDF')
const envelope = (data: unknown) => Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(data) }] }] })

describe('GUIBOR A3 visual contract', () => {
  it('constrains the provider key to 50 digits or null without requesting digit repair', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope(visualFixture()))
    await extractNfseVisual(bytes, { env: { OPENAI_API_KEY: 'synthetic' }, fetchImpl })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.text.format.schema.properties.chave_acesso_nfse.properties.value)
      .toEqual({ type: ['string', 'null'], pattern: '^[0-9]{50}$' })
    const prompt = body.input[0].content.find((part: { type: string }) => part.type === 'input_text').text
    expect(prompt).toContain('preservando cada zero consecutivo')
    expect(prompt).toContain('Nunca adicione, remova, complete ou corrija digitos')
    expect(prompt).toContain('chave_acesso_nfse.value=null e ambiguous=true')
  })
  it('preserves a synthetic long zero run exactly, without numeric conversion', () => {
    const key = '123456789' + '0'.repeat(30) + '12345678901'
    expect(key).toHaveLength(50)
    const result = validateVisualNfse({ ...visualFixture(),
      chave_acesso_nfse: { label: 'CHAVE DE ACESSO DA NFS-e', value: key },
    })
    expect(result.dados.chave_acesso).toBe(key)
  })
  it.each([44, 49, 51])('rejects %i-digit keys even if the provider ignores its schema', length => {
    const key = ('1234567890'.repeat(6)).slice(0, length)
    const pattern = VISUAL_NFSE_JSON_SCHEMA.properties.chave_acesso_nfse.properties.value.pattern
    expect(new RegExp(pattern).test(key)).toBe(false)
    expect(() => validateVisualNfse({ ...visualFixture(),
      chave_acesso_nfse: { label: 'CHAVE DE ACESSO DA NFS-e', value: key },
    })).toThrow('NFSE_VISUAL_FISCAL_CONFLICT')
  })
  it('extracts explicit net, dates, no due, dedicated provenance without NF-e offsets', () => {
    const result = validateVisualNfse(visualFixture())
    expect(result.dados).toMatchObject({ numero_nf: '232', valor_bruto: 112710.81, valor_liquido: 105779.10, data_emissao: '2026-09-15', competencia: '2026-09-15', cnpj_emitente: '11222333000181' })
    expect(result.dados.chave_acesso).toHaveLength(50)
    expect(result.dados.data_vencimento).toBeUndefined()
    expect(result.vencimento_source).toBe('MISSING')
    expect(result.strategy).toBe('danfse_v2_visual')
    expect(result.proveniencia.valor_liquido?.source).toBe('PDF_VISUAL_FALLBACK')
    expect(result.candidatos).toEqual({})
  })
  it.each([
    { document_count: 2 }, { ambiguous: true }, { document_kind: 'nfe_danfe' }, { fingerprint: null }, { confidence: 0.84 },
    { prestador_cnpj: { label: 'CNPJ / CPF / NIF', value: '11.222.333/0001-00' } },
    { chave_acesso_nfse: { label: 'CHAVE DE ACESSO DA NFS-e', value: '1'.repeat(44) } },
    { numero_nfse: { label: 'NÚMERO DA DPS', value: '232' } },
    { data_emissao: { label: 'DATA E HORA DA EMISSÃO DA NFS-e', value: '31/02/2026' } },
    { valor_liquido_nfse: { label: 'VALOR LÍQUIDO DA NFS-e + IBS/CBS', value: 'R$ 105.779,10' } },
    { valor_liquido_nfse: { label: 'VALOR LÍQUIDO DA NFS-e', value: 'R$ 1,00' } },
    { valor_liquido_nfse: { label: 'VALOR LÍQUIDO DA NFS-e', value: 'R$ 0,00' } },
    { valor_liquido_nfse: { label: 'VALOR LÍQUIDO DA NFS-e', value: 'R$ 999.999,00' } },
    { vencimento: { label: 'COMPETÊNCIA DA NFS-e', value: '15/09/2026' } },
    { prestador_nome: { label: 'Nome / Nome Empresarial', value: 'QA\nDANFSe v2.0' } },
  ])('rejects conflicting contract %j', override => expect(() => validateVisualNfse({ ...visualFixture(), ...override })).toThrow(/^NFSE_VISUAL_/))
  it('does not replace absent net with gross', () => {
    const result = validateVisualNfse({ ...visualFixture(), valor_liquido_nfse: { label: null, value: null } })
    expect(result.dados.valor_liquido).toBeUndefined()
  })
  it.each([
    ['valor_liquido_nfse', 'VALOR LÍQUIDO DA NFS-e', 'valor_liquido'],
    ['valor_liquido_nfse_mais_ibscbs', 'VALOR LÍQUIDO DA NFS-e + IBS/CBS', 'valor_liquido_com_ibscbs'],
    ['total_retencoes', 'Total das Retenções (ISSQN / Federais)', 'total_retencoes'],
    ['desconto_incondicionado', 'Desconto Incondicionado', 'desconto_incondicionado'],
    ['vencimento', 'DATA DE VENCIMENTO', 'data_vencimento'],
    ['vencimento', 'VENCIMENTO', 'data_vencimento'],
  ] as const)('keeps labeled but empty %s absent, without fabricated provenance', (field, label, output) => {
    const input = { ...visualFixture(), [field]: { label, value: null } }
    const result = validateVisualNfse(input)
    expect(result.dados[output]).toBeUndefined()
    expect(result.proveniencia[output]).toBeUndefined()
    expect(result.confianca[output]).toBeUndefined()
    expect(input[field]).toEqual({ label, value: null })
    expect(result.dados.valor_bruto).toBe(112710.81)
    expect(result.vencimento_source).toBe('MISSING')
  })
  it.each([
    'numero_nfse', 'chave_acesso_nfse', 'data_emissao', 'competencia',
    'prestador_cnpj', 'prestador_nome', 'tomador_cnpj', 'tomador_nome', 'valor_operacao_servico',
  ] as const)('still rejects mandatory %s with label but no value', field => {
    const input = visualFixture()
    input[field].value = null
    expect(() => validateVisualNfse(input)).toThrow('NFSE_VISUAL_FISCAL_CONFLICT')
  })
  it.each([
    { vencimento: { label: 'COMPETÊNCIA DA NFS-e', value: null } },
    { valor_liquido_nfse: { label: 'VALOR LÍQUIDO DA NFS-e + IBS/CBS', value: null } },
    { desconto_incondicionado: { label: '', value: null } },
    { total_retencoes: { label: 'OUTRO TOTAL', value: null } },
  ])('does not ignore conflicting labels on null fields %j', override => {
    expect(() => validateVisualNfse({ ...visualFixture(), ...override })).toThrow('NFSE_VISUAL_LABEL_CONFLICT')
  })
  it('does not synthesize missing net from gross, retentions or auxiliary net', () => {
    const result = validateVisualNfse({ ...visualFixture(),
      valor_liquido_nfse: { label: 'VALOR LÍQUIDO DA NFS-e', value: null },
      valor_liquido_nfse_mais_ibscbs: { label: 'VALOR LÍQUIDO DA NFS-e + IBS/CBS', value: 'R$ 106.000,00' },
    })
    expect(result.dados.valor_liquido).toBeUndefined()
    expect(result.dados.valor_liquido_com_ibscbs).toBe(106000)
  })
  it('keeps labeled missing due in review after visual provider extraction', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ ...visualFixture(),
      desconto_incondicionado: { label: 'DESCONTO INCONDICIONADO', value: null },
      valor_liquido_nfse_mais_ibscbs: { label: 'VALOR LÍQUIDO DA NFS-e + IBS/CBS', value: null },
      vencimento: { label: 'VENCIMENTO', value: null },
    }))
    const result = await extractNfseVisual(bytes, { env: { OPENAI_API_KEY: 'synthetic' }, fetchImpl })
    const prepared = prepareNfsePersistence(result, '', 'a'.repeat(64), '2026-09-29')
    expect(prepared).toEqual({ kind: 'review', review: {
      numero: '232', bruto: 112710.81, liquido: 105779.10, emissao: '2026-09-15', strategy: 'danfse_v2_visual',
    } })
    expect(prepared).not.toHaveProperty('values')
    expect(result.dados.data_vencimento).toBeUndefined()
  })
  it('does not use IBS/CBS auxiliary as net', () => {
    const result = validateVisualNfse({ ...visualFixture(), valor_liquido_nfse_mais_ibscbs: { label: 'VALOR LÍQUIDO DA NFS-e + IBS/CBS', value: 'R$ 106.000,00' } })
    expect(result.dados.valor_liquido).toBe(105779.10)
    expect(result.dados.valor_liquido_com_ibscbs).toBe(106000)
  })
  it('no provider credential fails closed without network', async () => {
    const fetchImpl = vi.fn()
    await expect(extractNfseVisual(bytes, { env: {}, fetchImpl })).rejects.toThrow('NFSE_VISUAL_NOT_CONFIGURED')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('sends strict dedicated schema with no retention and sanitizes errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope(visualFixture()))
    await extractNfseVisual(bytes, { env: { OPENAI_API_KEY: 'synthetic' }, fetchImpl })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.store).toBe(false)
    expect(body.text.format).toMatchObject({ name: 'nfse_danfse_v2_extraction', strict: true })
    fetchImpl.mockRejectedValue(new Error('secret provider response'))
    await expect(extractNfseVisual(bytes, { env: { OPENAI_API_KEY: 'synthetic' }, fetchImpl })).rejects.toThrow('NFSE_VISUAL_UNAVAILABLE')
  })
  it('classifier refuses ambiguous, weak and multiple document fingerprints', async () => {
    for (const override of [{ document_count: 2 }, { confidence: 0.2 }, { fingerprint: 'DANFE' }, { document_kind: 'uncertain' }]) {
      await expect(classifyFiscalImage(bytes, { env: { OPENAI_API_KEY: 'synthetic' }, fetchImpl: vi.fn().mockResolvedValue(envelope({ document_kind: 'nfse_danfse_v2', fingerprint: 'DANFSe v2.0', document_count: 1, confidence: 0.98, ...override })) })).rejects.toThrow('NFSE_VISUAL_CLASSIFICATION_AMBIGUOUS')
    }
  })
})

describe('fiscal PDF dispatch gate', () => {
  it('text NFS-e never calls vision', async () => {
    const visual = vi.fn(), classify = vi.fn()
    const result = await probeNfsePdf(bytes, { native: async () => ({ text: danfseFixture() }), visual, classify })
    expect(result?.strategy).toBe('danfse_v2_labels')
    expect(visual).not.toHaveBeenCalled(); expect(classify).not.toHaveBeenCalled()
  })
  it('image NFS-e requires positive classification before dedicated extraction', async () => {
    const visual = vi.fn().mockResolvedValue(validateVisualNfse(visualFixture()))
    const classify = vi.fn().mockResolvedValue('nfse_danfse_v2')
    expect((await probeNfsePdf(bytes, { native: async () => ({ text: '\n ' }), classify, visual }))?.strategy).toBe('danfse_v2_visual')
    expect(classify).toHaveBeenCalledOnce(); expect(visual).toHaveBeenCalledOnce()
  })
  it('NF-e text delegates to existing contract without visual calls', async () => {
    const classify = vi.fn()
    expect(await probeNfsePdf(bytes, { native: async () => ({ text: 'DANFE VALOR TOTAL DA NOTA DATA DE EMISSAO '.repeat(5) }), classify })).toBeNull()
    expect(classify).not.toHaveBeenCalled()
  })
  it('image NF-e delegates to unchanged NF-e extraction, not NFS-e schema', async () => {
    const visual = vi.fn()
    expect(await probeNfsePdf(bytes, { native: async () => ({ text: '' }), classify: async () => 'nfe_danfe', visual })).toBeNull()
    expect(visual).not.toHaveBeenCalled()
  })
  it('text contradictions do not get repaired by AI', async () => {
    const visual = vi.fn()
    const result = await probeNfsePdf(bytes, { native: async () => ({ text: danfseFixture().replace('R$ 37.229,70', 'R$ 1,00') }), visual })
    expect(result?.avisos.length).toBeGreaterThan(0); expect(visual).not.toHaveBeenCalled()
  })
})
