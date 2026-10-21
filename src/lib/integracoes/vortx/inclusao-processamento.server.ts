import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { configurarRuntimeRelatorios, fundoRelatoriosConfigurado, relatoriosPermitidos } from './relatorios-runtime'
import { abrirEventoPreservado, eventoPreservadoSchema } from './relatorios-evento-preservado.server'
import { baixarRelatorioVortx, DownloadRelatorioError } from './relatorios-download.server'
import { prepararInclusaoVortx } from './inclusao-snapshot'
import { blocosEstoqueVortx } from './estoque-blocos'
import { RelatorioVortxError } from './relatorios-parser'

const jobSchema = z.object({ id: z.uuid(), lease: z.uuid(), fundo_id: z.uuid(), versao_id: z.uuid(),
  evento_id: z.uuid(), ambiente: z.enum(['producao', 'homologacao']), codigo_carteira: z.string(),
  data_referencia: z.iso.date(), data_inicio: z.iso.date(), data_fim: z.iso.date(), evento: eventoPreservadoSchema })
const resultadoSchema = z.object({ id: z.uuid(), estado: z.enum(['PERSISTIDO', 'REVISAO']), duplicada: z.boolean(),
  inclusoes: z.number().int().nonnegative(), conflitos: z.number().int().nonnegative() })
type Env = Readonly<Record<string, string | undefined>>

export function processamentoInclusaoPreviewPermitido(env: Env = process.env) {
  return relatoriosPermitidos(fundoRelatoriosConfigurado(env) ?? '', env)
    && env.VORTX_REPORT_INCLUSION_PROCESSING_ENABLED === 'true' && Boolean(env.VORTX_REPORT_DOWNLOAD_HOSTS?.trim())
}

/** One durable leased report per invocation; callbacks only wake this worker after receipt commits. */
export async function processarProximaInclusaoVortx(env: Env = process.env) {
  if (!processamentoInclusaoPreviewPermitido(env)) return { estado: 'DESABILITADO' as const }
  const client = createAdminClient()
  const fundoId = fundoRelatoriosConfigurado(env)!
  const reserved = await client.rpc('vortx_reservar_processamento_inclusao', { p_fundo_id: fundoId })
  if (reserved.error) throw new Error('PROCESSAMENTO_INDISPONIVEL')
  if (reserved.data === null) return { estado: 'AGUARDANDO_RELATORIO' as const }
  const job = jobSchema.parse(reserved.data)
  let etapa: 'CONTRATO' | 'DOWNLOAD' | 'PERSISTENCIA' = 'CONTRATO'
  try {
    const { row, evento } = abrirEventoPreservado(job.evento)
    if ((configurarRuntimeRelatorios(env)?.ambiente === 'production' && job.ambiente !== 'producao')
      || job.fundo_id !== fundoId || row.id !== job.evento_id
      || row.fundo_id !== job.fundo_id || row.ambiente !== job.ambiente || row.correlacao !== 'CORRELACIONADO'
      || evento.tipoRelatorio !== 'Inclusao' || evento.idCarteira !== job.codigo_carteira
      // Inclusion is an interval report: its provider point-reference may be a sentinel.
      // The guarded reservation supplies the canonical request reference; never rewrite the original event.
      || evento.dataInicio !== job.data_inicio || evento.dataFim !== job.data_fim
      || !evento.dataExpiracao || Date.parse(evento.dataExpiracao) <= Date.now()) throw new Error('SCOPE')
    etapa = 'DOWNLOAD'
    const bytes = await baixarRelatorioVortx(evento.urlRelatorio!, env.VORTX_REPORT_DOWNLOAD_HOSTS!.split(',').map(h => h.trim()).filter(Boolean))
    etapa = 'CONTRATO'
    const prepared = prepararInclusaoVortx({ contexto: { fundoId: job.fundo_id, ambiente: job.ambiente,
      codigoCarteira: job.codigo_carteira, dataReferencia: job.data_referencia, dataInicio: job.data_inicio, dataFim: job.data_fim },
    versaoId: job.versao_id, arquivo: bytes })
    etapa = 'PERSISTENCIA'
    const args = { p_id: job.id, p_lease: job.lease }
    const intent = await client.rpc('vortx_manifesto_inclusao', { ...args, p_manifesto: prepared.manifesto })
    if (intent.error || intent.data !== true) throw new Error('MANIFESTO_INDISPONIVEL')
    const file = prepared.manifesto.arquivo, bucket = client.storage.from(file.storage_bucket)
    const upload = await bucket.upload(file.storage_path, bytes, { contentType: 'text/csv', upsert: false })
    if (upload.error) throw new Error('ARQUIVO_PRIVADO_INDISPONIVEL')
    const compensar = async () => {
      const removed = await bucket.remove([file.storage_path])
      if (removed.error) throw new Error('COMPENSACAO_INDETERMINADA')
    }
    try {
      for (const chunk of blocosEstoqueVortx(prepared.linhas)) {
        const staged = await client.rpc('vortx_estagiar_inclusao', { ...args, p_ordem: chunk.ordem, p_linhas: chunk.linhas })
        if (staged.error || staged.data !== chunk.linhas.length) throw new Error('BLOCO_INDISPONIVEL')
      }
    } catch (error) { await compensar(); throw error }
    const completion = await client.rpc('vortx_concluir_inclusao', args)
    const result = resultadoSchema.safeParse(completion.data)
    if (completion.error || !result.success) {
      // Even an absent header observed now cannot rule out a commit still in flight.
      // The durable manifest retains ownership for a later, definitive reconciliation.
      throw new Error('PERSISTENCIA_INDETERMINADA')
    }
    if (result.data.duplicada && result.data.id !== prepared.manifesto.id) await compensar()
    return { ...result.data, publicado: false as const }
  } catch (error) {
    const motivo = error instanceof DownloadRelatorioError ? 'DOWNLOAD_FALHOU'
      : error instanceof RelatorioVortxError || etapa === 'CONTRATO' ? 'CONTRATO_INVALIDO' : 'PERSISTENCIA_INDETERMINADA'
    const failed = await client.rpc('vortx_falhar_inclusao', { p_id: job.id, p_lease: job.lease, p_erro: motivo })
    if (failed.error || failed.data !== true) throw new Error('RESULTADO_PROCESSAMENTO_INDETERMINADO')
    return { estado: 'FALHA' as const, motivo }
  }
}
