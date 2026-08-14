import { adicionarDiasCivis, diaUtilAnteriorOuIgual } from '@/lib/comunicacoes/calendario'
import type { RlxTipoBase } from './types'

export type RlxExpectativasCiclo = Record<RlxTipoBase, string>

function diaUtilAnterior(value: string): string {
  return diaUtilAnteriorOuIgual(adicionarDiasCivis(value, -1))
}

/**
 * Datas esperadas pelo ciclo D0. Este contrato apenas valida a ingestao;
 * nao resolve PL D-2 nem executa qualquer regra financeira futura.
 */
export function resolverExpectativasCicloRlx(dataOperacional: string): RlxExpectativasCiclo {
  const d1 = diaUtilAnterior(dataOperacional)
  const d2 = diaUtilAnterior(d1)
  return {
    CARTEIRA: d2,
    ESTOQUE: d1,
    AQUISICOES: d1,
    LIQUIDACOES: d1,
  }
}
