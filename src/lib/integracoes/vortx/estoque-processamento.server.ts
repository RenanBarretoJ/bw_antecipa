import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { relatoriosPreviewPermitidos } from './relatorios-operacao'
import { abrirEventoPreservado, eventoPreservadoSchema } from './relatorios-evento-preservado.server'
import { baixarRelatorioVortx, DownloadRelatorioError } from './relatorios-download.server'
import { ingerirEstoqueNativoVortx } from './estoque-ingestao.server'
import { RelatorioVortxError } from './relatorios-parser'

const jobSchema = z.object({ id: z.uuid(), lease: z.uuid(), fundo_id: z.uuid(), ambiente: z.enum(['producao', 'homologacao']),
  codigo_carteira: z.string(), data_referencia: z.iso.date(), versao_id: z.uuid(),
  ativo_evento_id: z.uuid(), parcela_evento_id: z.uuid(), ativo: eventoPreservadoSchema, parcela: eventoPreservadoSchema })
type Env = Readonly<Record<string, string | undefined>>
export function processamentoEstoquePreviewPermitido(env: Env = process.env) {
  return z.uuid().safeParse(env.VORTX_REPORTS_PREVIEW_FUNDO_ID).success
    && relatoriosPreviewPermitidos(env.VORTX_REPORTS_PREVIEW_FUNDO_ID ?? '', env)
    && env.VORTX_REPORT_STOCK_PROCESSING_ENABLED === 'true'
    && Boolean(env.VORTX_REPORT_DOWNLOAD_HOSTS?.trim())
}

/** One bounded pair per invocation. The durable ledger/lease survives invocation loss;
 * after() is only a wakeup, never the authority for receipt, deduplication or completion.
 * A protected worker endpoint can resume an interrupted lease after its expiry.
 */
export async function processarProximoEstoqueVortx(env: Env = process.env) {
  if (!processamentoEstoquePreviewPermitido(env)) return { estado: 'DESABILITADO' as const }
  const fundoId = env.VORTX_REPORTS_PREVIEW_FUNDO_ID!
  const client = createAdminClient()
  const reserved = await client.rpc('vortx_reservar_processamento_estoque', { p_fundo_id: fundoId })
  if (reserved.error) throw new Error('PROCESSAMENTO_INDISPONIVEL')
  if (reserved.data === null) return { estado: 'AGUARDANDO_PAR' as const }
  const job = jobSchema.parse(reserved.data)
  let etapa: 'CONTRATO' | 'DOWNLOAD' | 'PERSISTENCIA' = 'CONTRATO'
  try {
    if (job.fundo_id !== fundoId) throw new Error('SCOPE')
    const abrir = (tipo: 'PosicaoAtivo' | 'PosicaoParcela', id: string, value: unknown) => {
      const { row, evento } = abrirEventoPreservado(value)
      if (row.id !== id || row.fundo_id !== fundoId || row.ambiente !== job.ambiente || row.correlacao !== 'CORRELACIONADO'
        || evento.tipoRelatorio !== tipo || evento.idCarteira !== job.codigo_carteira || evento.dataReferencia !== job.data_referencia
        || !evento.dataExpiracao || Date.parse(evento.dataExpiracao) <= Date.now()) throw new Error('SCOPE')
      return evento.urlRelatorio!
    }
    const ativoUrl = abrir('PosicaoAtivo', job.ativo_evento_id, job.ativo)
    const parcelaUrl = abrir('PosicaoParcela', job.parcela_evento_id, job.parcela)
    const hosts = (env.VORTX_REPORT_DOWNLOAD_HOSTS ?? '').split(',').map(value => value.trim()).filter(Boolean)
    etapa = 'DOWNLOAD'
    // Sequential bounded downloads avoid doubling the transient body buffers under concurrency.
    const ativo = await baixarRelatorioVortx(ativoUrl, hosts)
    const parcela = await baixarRelatorioVortx(parcelaUrl, hosts)
    etapa = 'PERSISTENCIA'
    const downloaded = await client.rpc('vortx_marcar_download_estoque', { p_id: job.id, p_lease: job.lease })
    if (downloaded.error) throw new Error('DOWNLOAD_CHECKPOINT_UNAVAILABLE')
    const result = await ingerirEstoqueNativoVortx({ fundoId, dataReferencia: job.data_referencia,
      ativo: { nome: 'posicao-ativo.csv', conteudo: ativo }, parcela: { nome: 'posicao-parcela.csv', conteudo: parcela },
      execucao: { id: job.id, lease: job.lease, ambiente: job.ambiente, versaoId: job.versao_id, codigoCarteira: job.codigo_carteira } })
    // The canonical SQL completion decides financial eligibility; older servers
    // retain their stricter behavior until the forward migration is applied.
    const conferido = result.reconciliadoFinanceiro ?? result.reconciliado
    return { estado: conferido ? 'PERSISTIDO' as const : 'REVISAO' as const,
      ativos: result.resumo.ativos, parcelas: result.resumo.parcelas, duplicada: result.duplicada,
      divergencias: result.divergencias.length, pddPendente: result.pddPendente ?? false, publicado: false as const }
  } catch (error) {
    const motivo = error instanceof DownloadRelatorioError ? 'DOWNLOAD_FALHOU'
      : error instanceof RelatorioVortxError || etapa === 'CONTRATO' ? 'CONTRATO_INVALIDO' : 'PERSISTENCIA_INDETERMINADA'
    const failed = await client.rpc('vortx_falhar_processamento_estoque', { p_id: job.id, p_lease: job.lease, p_erro: motivo })
    if (failed.error || !failed.data) throw new Error('RESULTADO_PROCESSAMENTO_INDETERMINADO')
    return { estado: 'FALHA' as const, motivo }
  }
}
