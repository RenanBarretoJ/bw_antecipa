import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { contextoRelatoriosSchema, relatoriosPreviewPermitidos, solicitacaoRelatorioSchema } from './relatorios-operacao'
import { prepararSolicitacaoRelatorioVortx } from './relatorios-contrato'
import { enviarRelatorioReservado } from './relatorios-envio.server'
import { planejarRotinaRelatoriosVortx } from './relatorios-rotina'

type Env = Readonly<Record<string,string|undefined>>
export function rotinaRelatoriosPermitida(env: Env = process.env) {
  return env.VORTX_REPORTS_DAILY_ENABLED === 'true' && relatoriosPreviewPermitidos(env.VORTX_REPORTS_PREVIEW_FUNDO_ID ?? '', env)
}
const reservaSchema = z.object({ criada: z.boolean(), solicitacao: solicitacaoRelatorioSchema })
export async function executarRotinaRelatoriosVortx(env: Env = process.env, agora = new Date()) {
  if (!rotinaRelatoriosPermitida(env)) return { estado: 'DESABILITADA' as const }
  const plano = planejarRotinaRelatoriosVortx(agora)
  if (!plano.executar) return { estado: 'IGNORADA' as const, dataOperacional: plano.dataOperacional, motivo: plano.motivo }
  const client = createAdminClient(), fundoId = env.VORTX_REPORTS_PREVIEW_FUNDO_ID!
  const contextResult = await client.rpc('vortx_contexto_rotina', { p_fundo_id: fundoId })
  const contexto = contextoRelatoriosSchema.safeParse(contextResult.data)
  if (contextResult.error || !contexto.success || contexto.data.fundo.id !== fundoId) throw new Error('ROTINA_CONTEXTO_INDISPONIVEL')
  const resultados: Array<{ tipo: string; estado: string; nova?: boolean }> = []
  // Exactly four bounded iterations, no retry, self-invocation, fake Auth session or publication.
  for (const form of plano.pedidos) {
    const versoes = contexto.data.versoes.filter(v => v.capabilities.includes(form.capability))
    if (versoes.length !== 1) { resultados.push({ tipo: form.tipo, estado: 'FONTE_INDISPONIVEL' }); continue }
    const versao = versoes[0]
    try {
      const pedido = prepararSolicitacaoRelatorioVortx({ codigoCarteira: versao.carteira, tipoRelatorio: form.tipo,
        dataInicio: form.inicio, dataFim: form.fim, dataReferencia: form.referencia, extensaoArquivo: 2 }, plano.dataOperacional)
      const lease = randomBytes(32).toString('hex')
      const reserved = await client.rpc('vortx_rotina_reservar', { p_fundo_id: fundoId, p_versao_id: versao.id,
        p_tipo: pedido.tipoRelatorio, p_inicio: pedido.dataInicio, p_fim: pedido.dataFim, p_referencia: pedido.dataReferencia,
        p_lease_hash: createHash('sha256').update(lease).digest('hex') })
      if (reserved.error) throw new Error('ROTINA_RESERVA_INDISPONIVEL')
      const reserva = reservaSchema.parse(reserved.data), row = reserva.solicitacao
      if (row.fundo_id !== fundoId || row.integracao_versao_id !== versao.id || row.ambiente !== versao.ambiente
        || Object.entries(pedido).some(([key,value]) => row.pedido[key as keyof typeof pedido] !== value)) throw new Error('ROTINA_ESCOPO_INVALIDO')
      if (!reserva.criada) { resultados.push({ tipo: form.tipo, estado: row.estado, nova: false }); continue }
      if (row.origem !== 'CRON') throw new Error('ROTINA_ORIGEM_INVALIDA')
      const final = await enviarRelatorioReservado(row, async (estado, protocolo = null, http = null) => {
        const result = await client.rpc('vortx_rotina_transicionar', { p_id: row.id, p_lease: lease, p_estado: estado,
          p_protocolo: protocolo, p_http: http })
        if (result.error) throw new Error('ROTINA_TRANSICAO_INDISPONIVEL')
        return solicitacaoRelatorioSchema.parse(result.data)
      })
      resultados.push({ tipo: form.tipo, estado: final.estado, nova: true })
    } catch { resultados.push({ tipo: form.tipo, estado: 'REQUER_CONFERENCIA' }) }
  }
  return { estado: 'EXECUTADA' as const, dataOperacional: plano.dataOperacional, referencia: plano.pedidos[0].referencia, resultados }
}
