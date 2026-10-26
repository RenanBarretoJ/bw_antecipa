import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { extractDanfeFromPdf, validarDanfeParaPersistencia } from '@/lib/pdf-nf-parser'
import { parseFiscalFile } from '@/lib/fiscal-intake/parse.server'
import { prepareFiscalPersistence } from '@/lib/fiscal-intake/prepare'
import { importFiscalFile, type FiscalImportRepository } from '@/lib/fiscal-intake/service.server'

// Private inputs and golden values stay outside Git. Never log extracted text,
// descriptions, file names, patient data or a raw parser/result object.
const manifestPath = process.env.BW_NFE_PRIVATE_CORPUS_MANIFEST
type Original = { id: string; path: string; sha256: string; key: string; cents: number }
const originals: Original[] = manifestPath ? JSON.parse(readFileSync(manifestPath, 'utf8')) : []

describe('authorized private NF-e originals (local opt-in)', () => {
  it.skipIf(!manifestPath)('verifies exact bytes, real native extraction and canonical dispatch without external requests', async () => {
    let requests = 0
    vi.stubGlobal('fetch', async () => { requests++; throw new Error('PRIVATE_EXTERNAL_REQUEST_FORBIDDEN') })
    vi.stubEnv('NFSE_UPLOAD_ENABLED', 'false')
    try {
      for (const original of originals) {
        const bytes = readFileSync(original.path)
        const hash = createHash('sha256').update(bytes).digest('hex')
        if (hash !== original.sha256) throw new Error('PRIVATE_ORIGINAL_HASH_MISMATCH')
        const parsed = await extractDanfeFromPdf(bytes, { extractAi: async () => { requests++; throw new Error('AI_NOT_AUTHORIZED') } })
        const gate = validarDanfeParaPersistencia(parsed)
        // This deliberately exposes only non-clinical scalar diagnostics.
        console.info(JSON.stringify({ privateOriginalId: original.id, shaMatch: true, native: parsed.extraction_source,
          numberMatch: parsed.numero_nf === original.id, seriesMatch: parsed.serie === '2', keyMatch: parsed.chave_acesso === original.key,
          issue: parsed.data_emissao, due: parsed.data_vencimento ?? null, cents: Math.round((parsed.valor_bruto ?? 0) * 100),
          failedFields: gate.ok ? [] : gate.failedFields, reasons: parsed.motivos_bloqueio, confidence: parsed.confianca }))
        expect(gate.ok, 'PRIVATE_NATIVE_PARSE_GATE').toBe(true)
        expect(parsed.numero_nf === original.id, 'PRIVATE_NUMBER_MATCH').toBe(true)
        expect(parsed.chave_acesso === original.key, 'PRIVATE_KEY_MATCH').toBe(true)
        expect(Math.round((parsed.valor_bruto ?? 0) * 100) === original.cents, 'PRIVATE_EXACT_CENTS').toBe(true)
        expect(parsed.data_vencimento === undefined, 'PRIVATE_NO_PRINTED_DUE_DATE').toBe(true)
        const facts = await parseFiscalFile(new File([bytes], 'private-original.pdf', { type: 'application/pdf' }))
        expect(facts.kind, 'PRIVATE_REAL_DISPATCH').toBe('DANFE')
        // No private document is uploaded, persisted or copied. Prove the real
        // application boundary and the draft payload with isolated IO doubles.
        const scope = { fundoId: 'local-fund', cedenteId: 'local-cedente', cedenteFundoId: 'local-link', estabelecimentoId: 'local-issuer',
          cnpj: facts.issuerCnpj, razaoSocial: 'PRIVATE AUTHORIZED INPUT' }
        const repository: FiscalImportRepository = {
          resolveScope: vi.fn().mockResolvedValue(scope), reserve: vi.fn(), resumeReview: vi.fn(), openReview: vi.fn(),
          planStorage: vi.fn(), commit: vi.fn(), fail: vi.fn(),
        }
        const storage = { upload: vi.fn() }
        const result = await importFiscalFile({ actor: { type: 'HUMAN', userId: 'local-user' }, fundoId: scope.fundoId,
          file: new File([bytes], 'private-original.pdf', { type: 'application/pdf' }) }, { repository, storage, parse: async () => facts })
        expect(result.status === 'DUE_DATE_REQUIRED', 'PRIVATE_EXPLICIT_REVIEW_NO_WRITE').toBe(true)
        expect(repository.reserve, 'PRIVATE_NO_RESERVATION_BEFORE_CONFIRMATION').not.toHaveBeenCalled()
        expect(storage.upload, 'PRIVATE_NO_STORAGE_BEFORE_CONFIRMATION').not.toHaveBeenCalled()
        expect(() => prepareFiscalPersistence({ facts, scope, sha256: hash, today: '2026-10-26' }), 'PRIVATE_NO_DATE_DEFAULT').toThrow('INVALID')
        const prepared = prepareFiscalPersistence({ facts, scope, sha256: hash, today: '2026-10-26', danfeManualDue: '2026-11-30' })
        if ('kind' in prepared) throw new Error('PRIVATE_DRAFT_NOT_PREPARED')
        expect(prepared.values.data_vencimento === '2026-11-30' && prepared.values.vencimento_origem === 'MANUAL', 'PRIVATE_MANUAL_SOURCE').toBe(true)
        expect(prepared.values.valor_liquido === null && prepared.parcelas.length === 0, 'PRIVATE_NO_NET_OR_RECEIVABLE_INVENTED').toBe(true)
        expect(prepared.values.descricao_itens === null, 'PRIVATE_NO_FREE_CLINICAL_TEXT_IN_DRAFT_FIELDS').toBe(true)
        expect(Math.round(prepared.values.valor_bruto * 100) === original.cents, 'PRIVATE_DRAFT_CENTS_MATCH').toBe(true)
        expect(prepared.values.cnpj_emitente === original.key.slice(6, 20), 'PRIVATE_DRAFT_ISSUER_MATCH').toBe(true)
      }
      expect(requests, 'NO_EXTERNAL_CALLS').toBe(0)
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs() }
  })
})
