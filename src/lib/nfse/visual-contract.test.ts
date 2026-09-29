import { describe, it, expect, vi } from 'vitest'
import { validateVisualNfse } from './visual-contract'
import { visualFixture } from './fixtures/visual'
import { danfseFixture } from './fixtures/danfse-v2'
import { classifyFiscalImage, extractNfseVisual } from './openai-visual.server'
import { probeNfsePdf } from './pdf-dispatcher.server'
const bytes = Buffer.from('synthetic PDF')
const envelope = (data: unknown) => Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(data) }] }] })

describe('GUIBOR A3 visual contract', () => {
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
