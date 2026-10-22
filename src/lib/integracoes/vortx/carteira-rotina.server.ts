import 'server-only'
import { fundoRelatoriosConfigurado } from './relatorios-runtime'
import { carteiraProcessamentoPermitido, planejarRotinaCarteiraVortx } from './carteira-rotina'
import { consultarEPersistirCarteiraVortx } from './carteira-persistencia.server'

type Env = Readonly<Record<string, string | undefined>>
export function rotinaCarteiraPermitida(env: Env = process.env) {
  const fundo = fundoRelatoriosConfigurado(env)
  return !!fundo && env.VERCEL_ENV === 'production' && env.VORTX_CARTEIRA_DAILY_ENABLED === 'true' && carteiraProcessamentoPermitido(fundo, env)
}
export async function executarRotinaCarteiraVortx(env: Env = process.env, agora = new Date()) {
  if (!rotinaCarteiraPermitida(env)) return { estado: 'DESABILITADA' as const }
  const plano = planejarRotinaCarteiraVortx(agora)
  if (!plano.executar) return { estado: 'IGNORADA' as const, ...plano }
  const resultado = await consultarEPersistirCarteiraVortx({ fundoId: fundoRelatoriosConfigurado(env)!, dataReferencia: plano.dataReferencia })
  // Internal IDs/raw payloads never leave this technical endpoint. No loop or automatic retry.
  return { estado: resultado.estado, dataOperacional: plano.dataOperacional, dataReferencia: plano.dataReferencia }
}
