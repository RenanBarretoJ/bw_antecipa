import 'server-only'
import { requireAuthenticated, type AppSupabaseClient } from '@/lib/auth/authorization'
import { resolverContextoOperacionalNotaFiscal } from '@/lib/notas-fiscais/contexto-operacional.server'
import type { ProcessedUploadFile } from '@/lib/notas-fiscais/upload-batch'
import type { UploadTelemetry } from '@/lib/notas-fiscais/upload-observability'
import { FiscalIntakeError } from './contracts'
import { importFiscalFile } from './service.server'
import { parseFiscalFile } from './parse.server'
import { createFiscalImportRepository } from './repository.server'
import { createFiscalStorage } from './storage.server'

export async function importManualFiscalFile(input: {
  file: File; userId: string; cedenteId: string; cedenteFundoId: string; fundoId: string
  client: AppSupabaseClient; telemetry: UploadTelemetry; fileIndex: number; reviewIntent?: string; manualDue?: string
}): Promise<ProcessedUploadFile> {
  const result = await importFiscalFile({ actor: { type: 'HUMAN', userId: input.userId }, fundoId: input.fundoId,
    cedenteFundoId: input.cedenteFundoId, file: input.file,
    review: input.reviewIntent ? { intentId: input.reviewIntent, manualDue: input.manualDue ?? '' } : undefined,
  }, {
    repository: createFiscalImportRepository(input.client), storage: createFiscalStorage(),
    parse: async file => {
      const facts = await parseFiscalFile(file)
      // Preserve A3/A4's fresh session/MFA/context check after potentially slow AI.
      const auth = await requireAuthenticated(input.client).catch(() => { throw new FiscalIntakeError('DENIED') })
      const fresh = await resolverContextoOperacionalNotaFiscal(auth, input.cedenteId).catch(() => { throw new FiscalIntakeError('DENIED') })
      if (fresh.actorUserId !== input.userId || fresh.cedenteFundoId !== input.cedenteFundoId || fresh.fundoId !== input.fundoId) {
        throw new FiscalIntakeError('DENIED')
      }
      if (facts.kind === 'XML') input.telemetry.parsed(input.fileIndex, { parseStrategy: 'xml' })
      else input.telemetry.parsed(input.fileIndex, {
        layoutFingerprint: facts.parsed.layout_fingerprint,
        parseStrategy: facts.kind === 'NFSE' ? facts.parsed.strategy : facts.parsed.strategies?.[0],
        confidence: facts.parsed.confianca?.valor_bruto,
      })
      return facts
    },
  })
  if (result.status === 'IMPORTED') return { ok: true, id: result.nfId, isRascunho: true, nfNumero: result.numero }
  if (result.status === 'REQUIRES_REVIEW') return { ok: false, status: 'REQUIRES_REVIEW', review: result.review,
    error: 'Vencimento não informado no documento. Informe uma data de vencimento válida para concluir.' }
  if (result.status === 'DUPLICATE' || result.status === 'IN_PROGRESS') return { ok: false, status: 'DUPLICATE',
    error: result.status === 'DUPLICATE' ? 'Esta Nota Fiscal já foi cadastrada.' : 'Este documento já está em processamento ou aguardando revisão.' }
  if (result.status === 'MISSING_IDENTITY') return { ok: false, status: 'REJECTED_INVALID',
    error: 'Não foi possível identificar a chave fiscal. Envie o XML ou PDF que contenha a chave.' }
  if (result.status === 'CLEANUP_PENDING') return { ok: false, status: 'STORAGE_ERROR',
    error: 'A importação não foi concluída e a limpeza está pendente. Aguarde antes de reenviar ou contate o suporte.' }
  if (result.status === 'AMBIGUOUS') return { ok: false, status: 'REJECTED_AMBIGUOUS', error: 'Não foi possível interpretar esta Nota Fiscal com segurança.' }
  if (['INVALID', 'UNKNOWN_CEDENTE', 'ROUTING_DENIED'].includes(result.status)) return { ok: false, status: 'REJECTED_INVALID',
    error: 'Não foi possível validar o documento ou seu acesso neste contexto. Atualize a página e confira o arquivo.' }
  return { ok: false, status: 'PERSISTENCE_ERROR', error: 'Não foi possível concluir a importação. Verifique suas notas antes de reenviar.' }
}
