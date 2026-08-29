import { adicionarDiasCivis, diaUtilAnteriorOuIgual } from '@/lib/comunicacoes/calendario'
import type { TipoBaseFinanceiro } from './types'

export type ExpectativasCicloFinanceiro = Record<TipoBaseFinanceiro, string>

function diaUtilAnterior(value: string): string {
  return diaUtilAnteriorOuIgual(adicionarDiasCivis(value, -1))
}

/**
 * Datas esperadas pelo ciclo D0. Este contrato apenas valida a ingestao;
 * nao resolve o PL de referencia nem executa qualquer regra financeira futura.
 */
export function resolverExpectativasCicloFinanceiro(dataOperacional: string): ExpectativasCicloFinanceiro {
  const d1 = diaUtilAnterior(dataOperacional)
  const d2 = diaUtilAnterior(d1)
  return {
    CARTEIRA: d2,
    ESTOQUE: d1,
    AQUISICOES: d1,
    LIQUIDACOES: d1,
  }
}
