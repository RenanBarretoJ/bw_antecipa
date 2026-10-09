import { describe, expect, it, vi } from 'vitest'
import { importFiscalFile, type FiscalImportRepository, type FiscalImportInput } from './service.server'
import { FiscalIntakeError, type FiscalFacts } from './contracts'
import { extractDanfseV2 } from '@/lib/nfse/danfse-v2'
import { danfseFixture } from '@/lib/nfse/fixtures/danfse-v2'
import { NfseExtractionStageError } from '@/lib/nfse/extraction-failure'

const facts: FiscalFacts = { kind: 'DANFE', documentType: 'NFE', key: '1'.repeat(44), issuerCnpj: '11222333000181',
  parsed: { campos_extraidos: [], numero_nf: '42', valor_bruto: 100, chave_acesso: '1'.repeat(44) } }
const claim = { id: 'reservation', token: 'owner', generation: 1 }
const scope = { fundoId: 'fund', cedenteId: 'cedente', cedenteFundoId: 'link', estabelecimentoId: 'issuer', cnpj: '11222333000181', razaoSocial: 'QA' }
function setup() {
  const repository = {
    resolveScope: vi.fn().mockResolvedValue(scope), reserve: vi.fn().mockResolvedValue(claim),
    resumeReview: vi.fn().mockResolvedValue(claim), openReview: vi.fn().mockResolvedValue('review'),
    planStorage: vi.fn().mockResolvedValue({ id: 'intent', bucket: 'notas-fiscais', path: 'reserved/path' }),
    commit: vi.fn().mockResolvedValue({ nfId: 'nf', numero: '42' }),
    fail: vi.fn().mockResolvedValue({ status: 'CLEANUP_PENDING' }),
  } satisfies FiscalImportRepository
  const storage = { upload: vi.fn().mockResolvedValue(undefined) }
  const parse = vi.fn().mockResolvedValue(facts)
  const input: FiscalImportInput = { actor: { type: 'HUMAN', userId: 'real-user' }, fundoId: 'fund', file: new File(['%PDF-QA'], 'qa.pdf') }
  return { repository, storage, parse, input, today: () => '2026-09-29' }
}

describe('shared fiscal import orchestration', () => {
  it.each(['HUMAN', 'SYSTEM'] as const)('preserves %s extraction-failure outcome and never reserves', async actor => {
    const d = setup()
    if (actor === 'SYSTEM') d.input.actor = { type: 'SYSTEM', source: 'EMAIL_INTAKE', integrationId: 'i', messageId: 'm', attachmentId: 'a', attachmentToken: 't' }
    d.parse.mockRejectedValue(new NfseExtractionStageError('nfse_classification', new Error('NFSE_VISUAL_TIMEOUT'), 30000))
    expect(await importFiscalFile(d.input, d)).toEqual({ status: 'RETRYABLE_ERROR' })
    expect(d.repository.resolveScope).not.toHaveBeenCalled()
    expect(d.repository.reserve).not.toHaveBeenCalled()
    expect(d.storage.upload).not.toHaveBeenCalled()
  })
  it.each(['DUPLICATE', 'IN_PROGRESS', 'CLEANUP_PENDING'] as const)('does not touch Storage for %s', async status => {
    const d = setup(); d.repository.reserve.mockResolvedValue({ status })
    expect(await importFiscalFile(d.input, d)).toEqual({ status })
    expect(d.repository.planStorage).not.toHaveBeenCalled()
    expect(d.storage.upload).not.toHaveBeenCalled()
  })
  it.each(['UNKNOWN_CEDENTE', 'ROUTING_DENIED', 'AMBIGUOUS'] as const)('does not reserve an unauthorized/unknown route: %s', async status => {
    const d = setup(); d.repository.resolveScope.mockResolvedValue({ status })
    expect(await importFiscalFile(d.input, d)).toEqual({ status })
    expect(d.repository.reserve).not.toHaveBeenCalled()
    expect(d.storage.upload).not.toHaveBeenCalled()
  })
  it('uses the exact same orchestration for a technical actor without inventing a user', async () => {
    const d = setup()
    const repository = { ...d.repository, companion: vi.fn().mockResolvedValue({ kind: 'CREATE_NF' }) }
    d.parse.mockResolvedValue({ ...facts, parsed: { ...facts.parsed, cnpj_emitente: '11222333000181', data_emissao: '2026-09-29',
      origem_valor_bruto: 'valor_total_nota', confianca: { numero_nf: 0.99, cnpj_emitente: 0.99, data_emissao: 0.99, valor_bruto: 0.99 } } })
    d.input.actor = { type: 'SYSTEM', source: 'EMAIL_INTAKE', integrationId: 'integration', messageId: 'message', attachmentId: 'attachment', attachmentToken: 'lease' }
    expect(await importFiscalFile(d.input, { ...d, repository })).toEqual({ status: 'IMPORTED', nfId: 'nf', numero: '42' })
    expect(d.repository.reserve.mock.calls[0][0].actor).toEqual(d.input.actor)
    expect(d.repository.planStorage.mock.invocationCallOrder[0]).toBeLessThan(d.storage.upload.mock.invocationCallOrder[0])
    expect(d.storage.upload.mock.invocationCallOrder[0]).toBeLessThan(d.repository.commit.mock.invocationCallOrder[0])
  })
  it('requires the document identity gate for system NFE instead of falling back to fiscal creation', async () => {
    const d = setup()
    d.input.actor = { type: 'SYSTEM', source: 'EMAIL_INTAKE', integrationId: 'integration', messageId: 'message', attachmentId: 'attachment', attachmentToken: 'lease' }
    expect(await importFiscalFile(d.input, d)).toEqual({ status: 'RETRYABLE_ERROR' })
    expect(d.repository.reserve).not.toHaveBeenCalled()
    expect(d.storage.upload).not.toHaveBeenCalled()
  })
  it('rejects missing identity before reservation in both channels', async () => {
    const d = setup(); d.parse.mockRejectedValue(new FiscalIntakeError('MISSING_IDENTITY'))
    expect(await importFiscalFile(d.input, d)).toEqual({ status: 'MISSING_IDENTITY' })
    expect(d.repository.reserve).not.toHaveBeenCalled()
  })
  it('persists an uncertain upload as cleanup pending without fiscal commit', async () => {
    const d = setup(); d.storage.upload.mockRejectedValue(new Error('uncertain network response'))
    expect(await importFiscalFile(d.input, d)).toEqual({ status: 'CLEANUP_PENDING' })
    expect(d.repository.fail).toHaveBeenCalledWith(claim)
    expect(d.repository.commit).not.toHaveBeenCalled()
  })
  it('recovers a committed response instead of deleting Storage after a response timeout', async () => {
    const d = setup(); d.repository.commit.mockRejectedValue(new Error('response lost'))
    d.repository.fail.mockResolvedValue({ status: 'IMPORTED', nfId: 'nf', numero: '42' })
    expect(await importFiscalFile(d.input, d)).toEqual({ status: 'IMPORTED', nfId: 'nf', numero: '42' })
  })
  it('keeps a known NFS-e identity reserved during the official review, without Storage', async () => {
    const d = setup(); const parsed = extractDanfseV2(danfseFixture())
    d.parse.mockResolvedValue({ kind: 'NFSE', documentType: 'NFSE', key: parsed.dados.chave_acesso!, issuerCnpj: parsed.dados.cnpj_emitente!, parsed })
    const result = await importFiscalFile(d.input, d)
    expect(result.status).toBe('REQUIRES_REVIEW')
    expect(d.repository.openReview).toHaveBeenCalledOnce()
    expect(d.storage.upload).not.toHaveBeenCalled()
  })
  it('does not accept a SYSTEM actor completing a manual due date', async () => {
    const d = setup(); const parsed = extractDanfseV2(danfseFixture())
    d.parse.mockResolvedValue({ kind: 'NFSE', documentType: 'NFSE', key: parsed.dados.chave_acesso!, issuerCnpj: parsed.dados.cnpj_emitente!, parsed })
    d.input.actor = { type: 'SYSTEM', source: 'EMAIL_INTAKE', integrationId: 'i', messageId: 'm', attachmentId: 'a', attachmentToken: 't' }
    d.input.review = { intentId: 'review', manualDue: '2026-10-30' }
    expect(await importFiscalFile(d.input, d)).toEqual({ status: 'INVALID' })
    expect(d.repository.resumeReview).not.toHaveBeenCalled()
  })
})
