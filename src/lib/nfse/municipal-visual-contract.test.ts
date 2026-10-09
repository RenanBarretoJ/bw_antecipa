import { describe, expect, it, vi } from 'vitest'
import { municipalFixture } from './fixtures/municipal'
import { danfseFixture } from './fixtures/danfse-v2'
import { validateMunicipalVisual } from './municipal-visual-contract'
import { extractDanfseV2, validateNfseExtraction } from './danfse-v2'
import { prepareNfsePersistence } from './persistence'
import { fiscalFingerprint, nfseIdentity, sha256 } from './review-facts'
import { classifyFiscalImage, extractMunicipalNfseVisual } from './openai-visual.server'
import { probeNfsePdf } from './pdf-dispatcher.server'

const envelope = (value: unknown) => Response.json({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] })
const bytes = Buffer.from('synthetic PDF')

describe('municipal NFS-e extension', () => {
  it('preserves printed facts and requires review without due, net or invented national key', () => {
    const result = validateMunicipalVisual(municipalFixture())
    expect(validateNfseExtraction(result)).toEqual({ ok: true })
    expect(result.dados).toMatchObject({ numero_nf: '1234', valor_bruto: 12345.67, data_emissao: '2026-10-02' })
    expect(result.dados.chave_acesso).toBeUndefined()
    expect(result.dados.valor_liquido).toBeUndefined()
    expect(result.dados.data_vencimento).toBeUndefined()
    expect(result.proveniencia.valor_bruto?.source).toBe('PDF_VISUAL_FALLBACK')
    expect(prepareNfsePersistence(result, '', 'a'.repeat(64), '2026-10-02').kind).toBe('review')
  })
  it('persists explicit municipal identity only after valid manual due', () => {
    const result = validateMunicipalVisual(municipalFixture())
    const ready = prepareNfsePersistence(result, '2026-11-01', 'a'.repeat(64), '2026-10-02')
    expect(ready.kind).toBe('ready')
    if (ready.kind !== 'ready') throw new Error('expected ready')
    expect(ready.values).toMatchObject({ chave_acesso: null, valor_liquido: null, vencimento_origem: 'MANUAL',
      fiscal_proveniencia: { strategy: 'nfse_municipal_visual', codigo_verificacao: 'QA.1234.5678-X' } })
  })
  it('keeps national identity, validation and review hash format unchanged', () => {
    const national = extractDanfseV2(danfseFixture())
    expect(nfseIdentity(national)).toBe(national.dados.chave_acesso)
    expect(sha256(nfseIdentity(national))).toBe(sha256(national.dados.chave_acesso!))
    const absentKey = { ...national, dados: { ...national.dados, chave_acesso: undefined } }
    expect(validateNfseExtraction(absentKey).ok).toBe(false)
  })
  it('fences identity independent of file/code while detecting changed fiscal facts', () => {
    const first = validateMunicipalVisual(municipalFixture())
    const changed = validateMunicipalVisual({ ...municipalFixture(), codigo_verificacao: { label: 'Código Verificação', value: 'QA-CHANGED' } })
    expect(nfseIdentity(first)).toBe(nfseIdentity(changed))
    expect(fiscalFingerprint(first)).not.toBe(fiscalFingerprint(changed))
    expect(nfseIdentity({ ...first, dados: { ...first.dados, cnpj_emitente: '12345678000195' } })).not.toBe(nfseIdentity(first))
  })
  it.each([
    { document_count: 2 }, { ambiguous: true }, { confidence: 0.84 }, { document_kind: 'nfe_danfe' },
    { orgao_emissor: 'EMPRESA DE TESTE' }, { titulo: 'RECIBO DE PAGAMENTO' },
    { numero_nf: { label: 'Número RPS', value: '1234' } },
    { numero_nf: { label: 'Número da Nota', value: '0' } },
    { codigo_verificacao: { label: null, value: null } },
    { cnpj_emitente: { label: 'CNPJ/CPF', value: '11.222.333/0001-00' } },
    { data_emissao: { label: 'Data Emissão', value: '31/02/2026' } },
    { data_vencimento: { label: 'Competência', value: '31/10/2026' } },
    { data_vencimento: { label: 'Vencimento', value: '01/10/2026' } },
    { valor_liquido: { label: 'Valor total', value: '1.000,00' } },
    { valor_liquido: { label: 'Valor Líquido', value: '99.999,00' } },
    { valor_bruto: { label: 'Base de cálculo', value: '100,00' } },
  ])('rejects ungrounded or conflicting evidence %j', candidate => {
    expect(() => validateMunicipalVisual({ ...municipalFixture(), ...candidate })).toThrow(/^NFSE_VISUAL_/)
  })
  it('routes image-only and municipal native text separately from national parser', async () => {
    const municipal = vi.fn(async () => validateMunicipalVisual(municipalFixture()))
    const visual = vi.fn()
    for (const text of ['', 'NOTA FISCAL ELETRONICA DE SERVICOS\n' + 'Texto fiscal '.repeat(10)]) {
      const result = await probeNfsePdf(bytes, { native: async () => ({ text }), classify: async () => 'nfse_municipal', municipal, visual })
      expect(result?.strategy).toBe('nfse_municipal_visual')
    }
    expect(visual).not.toHaveBeenCalled()
  })
  it('passes a scanned DANFE through to existing NF-e extraction', async () => {
    const municipal = vi.fn(), visual = vi.fn()
    expect(await probeNfsePdf(bytes, { native: async () => ({ text: '' }), classify: async () => 'nfe_danfe', municipal, visual })).toBeNull()
    expect(municipal).not.toHaveBeenCalled()
    expect(visual).not.toHaveBeenCalled()
  })
  it('classifies municipal documents and instructs the provider not to count blank pages', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(envelope({ document_kind: 'nfse_municipal', fingerprint: null, document_count: 1, confidence: .96 }))
    expect(await classifyFiscalImage(bytes, { env: { OPENAI_API_KEY: 'synthetic' }, fetchImpl })).toBe('nfse_municipal')
    expect(fetchImpl.mock.calls[0][1].body).toContain('paginas vazias')
    fetchImpl.mockResolvedValue(envelope(municipalFixture()))
    expect((await extractMunicipalNfseVisual(bytes, { env: { OPENAI_API_KEY: 'synthetic' }, fetchImpl })).strategy).toBe('nfse_municipal_visual')
  })
})
