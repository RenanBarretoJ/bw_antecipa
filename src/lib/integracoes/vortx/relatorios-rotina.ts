import { adicionarDiasCivis, dataCivilSaoPaulo, diaUtilAnterior } from '@/lib/comunicacoes/calendario'
import { ehDiaUtilAnbima } from '@/lib/operacoes/calculo'
import { RELATORIOS_OPERADOR } from './relatorios-operacao'

/** Human dates never select a scheduled run; this plan is derived from the civil server clock. */
export function planejarRotinaRelatoriosVortx(agora = new Date()) {
  const dataOperacional = dataCivilSaoPaulo(agora)
  if (!ehDiaUtilAnbima(dataOperacional)) return { dataOperacional, executar: false as const, motivo: 'DIA_NAO_UTIL_ANBIMA' as const, pedidos: [] }
  const referencia = diaUtilAnterior(dataOperacional)
  return { dataOperacional, executar: true as const, motivo: null,
    pedidos: RELATORIOS_OPERADOR.map(({ tipo, capability }) => ({ tipo, capability,
      inicio: adicionarDiasCivis(referencia, -1), fim: referencia, referencia, extensao: 2 as const })) }
}
