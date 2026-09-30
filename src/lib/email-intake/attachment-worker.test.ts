import { describe, expect, it, vi } from 'vitest'
import { processAttachmentJob } from './attachment-worker.server'
import type { FiscalImportInput } from '@/lib/fiscal-intake/service.server'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
const bytes = new TextEncoder().encode('%PDF-1.7\nfixture')
const job = { id: 'attachment', token: 'fence', messageId: 'message', integrationId: 'integration', fundoId: 'fund',
  messageExternalId: 'immutable-message', attachmentExternalId: 'immutable-attachment', fileName: 'nota.pdf',
  contentType: 'application/pdf', size: bytes.length, inline: false, kind: 'FILE' as const }

describe('worker de anexos usa o serviço fiscal compartilhado', () => {
  it('transmite bytes, fundo e ator técnico explícito; não cria usuário humano', async () => {
    const downloadAttachment = vi.fn().mockResolvedValue(bytes)
    const importer = vi.fn(async (input: FiscalImportInput) => {
      expect(input.actor).toEqual({ type: 'SYSTEM', source: 'EMAIL_INTAKE', integrationId: job.integrationId,
        messageId: job.messageId, attachmentId: job.id, attachmentToken: job.token })
      expect(input.fundoId).toBe(job.fundoId)
      expect(new Uint8Array(await input.file.arrayBuffer())).toEqual(bytes)
      return { status: 'IMPORTED' as const, nfId: 'nf', numero: '1' }
    })
    expect(await processAttachmentJob(job, { downloadAttachment }, importer)).toMatchObject({ status: 'IMPORTED' })
    expect(downloadAttachment).toHaveBeenCalledWith(job.messageExternalId, job.attachmentExternalId)
    expect(importer).toHaveBeenCalledOnce()
  })

  it('ignora inline sem download nem importação', async () => {
    const downloadAttachment = vi.fn()
    const importer = vi.fn()
    expect(await processAttachmentJob({ ...job, inline: true }, { downloadAttachment }, importer)).toEqual({ status: 'IGNORED' })
    expect(downloadAttachment).not.toHaveBeenCalled()
    expect(importer).not.toHaveBeenCalled()
  })

  it('rejeita conteúdo incompatível antes de invocar o serviço', async () => {
    const importer = vi.fn()
    await expect(processAttachmentJob(job, { downloadAttachment: vi.fn().mockResolvedValue(new Uint8Array(bytes.length)) }, importer)).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' })
    expect(importer).not.toHaveBeenCalled()
  })

  it.each(['DUPLICATE', 'IN_PROGRESS', 'CLEANUP_PENDING', 'UNKNOWN_CEDENTE', 'ROUTING_DENIED', 'INVALID', 'RETRYABLE_ERROR', 'FAILED'] as const)(
    'preserva o resultado explícito %s sem interpretar texto', async status => {
      const result = { status }
      expect(await processAttachmentJob(job, { downloadAttachment: vi.fn().mockResolvedValue(bytes) }, vi.fn().mockResolvedValue(result))).toBe(result)
    },
  )

  it('falha de B não desfaz a importação de A da mesma mensagem', async () => {
    const importer = vi.fn().mockResolvedValueOnce({ status: 'IMPORTED', nfId: 'nf-a', numero: '1' }).mockResolvedValueOnce({ status: 'INVALID' })
    const provider = { downloadAttachment: vi.fn().mockResolvedValue(bytes) }
    const results = await Promise.all([processAttachmentJob(job, provider, importer), processAttachmentJob({ ...job, id: 'b' }, provider, importer)])
    expect(results).toEqual([{ status: 'IMPORTED', nfId: 'nf-a', numero: '1' }, { status: 'INVALID' }])
  })
})
