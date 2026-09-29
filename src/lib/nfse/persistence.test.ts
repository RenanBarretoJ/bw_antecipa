import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { prepareNfsePersistence, validManualDue } from './persistence'
import { extractDanfseV2 } from './danfse-v2'
import { danfseFixture } from './fixtures/danfse-v2'
import { executarUploadPorArquivo, arquivosPendentesDeRetry } from '../notas-fiscais/upload-batch'
const sha = 'a'.repeat(64), today = '2026-09-29'
describe('GUIBOR A4 pre-insert review', () => {
  it.each(['', '2026-02-31', 'today', '2026-09-01'])('missing/invalid due %s never inserts today', due => {
    const result = prepareNfsePersistence(extractDanfseV2(danfseFixture()), due, sha, today)
    expect(result.kind).toBe('review'); expect(result).not.toHaveProperty('values')
  })
  it('persists explicit net separately and manual due with provenance', () => {
    const result = prepareNfsePersistence(extractDanfseV2(danfseFixture()), '2026-11-09', sha, today)
    expect(result).toMatchObject({ kind: 'ready', values: { tipo_documento_fiscal: 'NFSE', valor_bruto: 39521.98, valor_liquido: 37229.70,
      valor_liquido_origem: 'DOCUMENTO_EXPLICITO', data_vencimento: '2026-11-09', vencimento_origem: 'MANUAL',
      fiscal_proveniencia: { strategy: 'danfse_v2_labels', source: 'PDF_TEXT_NATIVE', vencimento_documento: null, sha256: sha } } })
  })
  it('missing net is null, never copied gross', () => {
    const text = danfseFixture().replace('VALOR LÍQUIDO DA NFS-e\nR$ 37.229,70\n', '')
    expect(prepareNfsePersistence(extractDanfseV2(text), '2026-11-09', sha, today)).toMatchObject({ kind: 'ready', values: { valor_liquido: null, valor_liquido_origem: 'NAO_INFORMADO' } })
  })
  it('document due is not overridden by caller', () => {
    const result = prepareNfsePersistence(extractDanfseV2(`${danfseFixture()}\nVENCIMENTO\n10/11/2026`), '2026-11-09', sha, today)
    expect(result).toMatchObject({ kind: 'ready', values: { data_vencimento: '2026-11-10', vencimento_origem: 'DOCUMENT' } })
  })
  it('invalid fiscal extraction cannot become ready with a date', () => expect(() => prepareNfsePersistence(extractDanfseV2(''), '2026-11-09', sha, today)).toThrow())
  it('validates calendar rather than lexical date only', () => {
    expect(validManualDue('2027-02-31', today, today)).toBe(false)
    expect(validManualDue('2026-11-09', today, today)).toBe(true)
  })
  it('review result stays per-file, not imported or removed from retry', async () => {
    const files = [{ name: 'A.pdf' }]
    const result = await executarUploadPorArquivo(files, async () => ({ ok: false, status: 'REQUIRES_REVIEW', error: 'review',
      review: { numero: '49', bruto: 1, liquido: null, emissao: today, strategy: 'danfse_v2_labels' } }))
    expect(result.ids).toEqual([]); expect(result.batch.successCount).toBe(0)
    expect(arquivosPendentesDeRetry(files, result.batch)).toEqual(files)
    expect(result.batch.results[0]).toHaveProperty('review')
  })
  it('migration is additive, preserves NOT NULL/history, audits actor and protects fiscal facts', () => {
    const migration = readFileSync('supabase/migrations/20260929154656_guibor_nfse_fiscal_provenance.sql', 'utf8')
    expect(migration).not.toMatch(/update\s+public\.notas_fiscais\s+set/i)
    expect(migration).not.toMatch(/drop\s+not\s+null/i)
    expect(migration).toContain('NFSE_VENCIMENTO_MANUAL'); expect(migration).toContain('auth.uid()')
    expect(migration).toContain('NFSE_FISCAL_FACTS_IMMUTABLE'); expect(migration).toContain('NFSE_LEGACY_REINTERPRETATION_DENIED')
  })
})
