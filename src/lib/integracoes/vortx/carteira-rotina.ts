import { dataCivilSaoPaulo, diaUtilAnterior } from '@/lib/comunicacoes/calendario'
import { ehDiaUtilAnbima } from '@/lib/operacoes/calculo'
import { relatoriosPermitidos } from './relatorios-runtime'

type Env = Readonly<Record<string, string | undefined>>
export const CARTEIRA_VORTX_AGENDA = { horario: '17h', fuso: 'America/Sao_Paulo', cronUtc: '0 20 * * 1-5' } as const

export function carteiraProcessamentoPermitido(fundoId: string, env: Env = process.env) {
  return env.VORTX_CARTEIRA_PROCESSING_ENABLED === 'true' && relatoriosPermitidos(fundoId, env)
    && ['producao', 'production', 'prod'].includes(env.INTEGRATION_RUNTIME_ENV ?? '')
}

/** Vortx Carteira: D-1 ANBIMA, independently of the legacy provider's D-2 contract. */
export function planejarRotinaCarteiraVortx(agora = new Date()) {
  const dataOperacional = dataCivilSaoPaulo(agora)
  const dataReferencia = diaUtilAnterior(dataOperacional)
  if (!ehDiaUtilAnbima(dataOperacional)) return { executar: false as const, motivo: 'DIA_NAO_UTIL_ANBIMA' as const, dataOperacional, dataReferencia }
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: CARTEIRA_VORTX_AGENDA.fuso, hour: '2-digit', hourCycle: 'h23' }).format(agora))
  if (hora < 17) return { executar: false as const, motivo: 'AGUARDANDO_17H' as const, dataOperacional, dataReferencia }
  return { executar: true as const, motivo: null, dataOperacional, dataReferencia }
}
