import Decimal from 'decimal.js'
import type {
  ExposureBaseRow,
  ExposureOverlayCandidate,
  ExposureLimitClassification,
  ExposureOverlayReason,
  ExposureQualityFlag,
} from './types'

const zero = () => new Decimal(0)
const asDecimal = (value: string | null | undefined) => value == null || value === '' ? null : new Decimal(value)
const money = (value: Decimal) => value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4)
const percent = (value: Decimal) => value.toDecimalPlaces(12, Decimal.ROUND_HALF_UP).toFixed(12)

export function classificarPercentualExposicao(
  percentual: string,
  limite: string,
): ExposureLimitClassification {
  const comparison = new Decimal(percentual).comparedTo(new Decimal(limite))
  if (comparison < 0) return 'ABAIXO_LIMITE'
  if (comparison > 0) return 'ACIMA_LIMITE'
  return 'NO_LIMITE'
}

/**
 * Uma operação candidata ainda não desembolsada não precisa possuir
 * comprovante de entrega. Para o controle de concentração, tudo que ainda
 * não está comprovadamente entregue entra conservadoramente como exposição
 * em trânsito. Requisitos logísticos pré-cessão continuam no gate
 * documental/logístico específico da política.
 */
export function classificarExposicaoLogisticaCandidata(
  status: 'ENTREGUE' | 'EM_TRANSITO' | 'INDETERMINADA' | null | undefined,
): 'ENTREGUE' | 'EM_TRANSITO' {
  return status === 'ENTREGUE' ? 'ENTREGUE' : 'EM_TRANSITO'
}
export function calcularAgregadosPosicao(rows: ExposureBaseRow[]) {
  let total = zero()
  let entregue = zero()
  let emTransito = zero()
  let indeterminada = zero()
  let semMatch = zero()
  let valorAusente = 0
  let quantidadeEntregue = 0
  let quantidadeEmTransito = 0
  let quantidadeIndeterminada = 0
  let quantidadeSemMatch = 0

  for (const row of rows) {
    const value = asDecimal(row.valorAquisicao)
    if (!value) valorAusente += 1
    else total = total.plus(value)
    if (row.statusVinculo === 'SEM_MATCH_FINANCEIRO_NF') {
      quantidadeSemMatch += 1
      if (value) semMatch = semMatch.plus(value)
      continue
    }
    if (row.statusLogistico === 'ENTREGUE') {
      quantidadeEntregue += 1
      if (value) entregue = entregue.plus(value)
    } else if (row.statusLogistico === 'EM_TRANSITO') {
      quantidadeEmTransito += 1
      if (value) emTransito = emTransito.plus(value)
    } else {
      quantidadeIndeterminada += 1
      if (value) indeterminada = indeterminada.plus(value)
    }
  }

  return {
    valorTotal: money(total), valorEntregue: money(entregue), valorEmTransito: money(emTransito),
    valorIndeterminado: money(indeterminada), valorSemMatch: money(semMatch), valorAusente,
    quantidadeEntregue, quantidadeEmTransito, quantidadeIndeterminada, quantidadeSemMatch,
  }
}

export function classificarOverlayCandidate(candidate: ExposureOverlayCandidate) {
  let reason: ExposureOverlayReason
  let included = false
  if (candidate.jaIncorporadoEstoque) reason = 'JA_INCORPORADO_ESTOQUE'
  else if (candidate.operacaoEconomicaEm.slice(0, 10) < candidate.dataOperacional) reason = 'OPERACAO_NAO_INCORPORADA'
  else if (!candidate.valorAquisicao) reason = 'VALOR_AUSENTE'
  else if (candidate.statusLogistico === 'EM_TRANSITO') {
    reason = 'INCLUIDA_EM_TRANSITO'
    included = true
  } else if (candidate.statusLogistico === 'ENTREGUE') reason = 'ENTREGUE'
  else reason = 'INDETERMINADA'
  return { ...candidate, motivo: reason, incluidoNoNumerador: included }
}

export function calcularExposicao(input: {
  posicaoEmTransito: string
  overlay: ReturnType<typeof classificarOverlayCandidate>[]
  patrimonioLiquido: string
  limite: string
  baseFlags?: ExposureQualityFlag[]
}) {
  let overlayTotal = zero()
  let overlayEmTransito = zero()
  let overlayEntregue = zero()
  let overlayIndeterminado = zero()
  let incorporado = zero()
  let naoIncorporado = zero()
  const flags = new Set(input.baseFlags || [])
  for (const item of input.overlay) {
    const value = asDecimal(item.valorAquisicao)
    if (!value) {
      flags.add('TEM_VALOR_AUSENTE')
      continue
    }
    overlayTotal = overlayTotal.plus(value)
    if (item.motivo === 'JA_INCORPORADO_ESTOQUE') incorporado = incorporado.plus(value)
    else if (item.motivo === 'OPERACAO_NAO_INCORPORADA') {
      naoIncorporado = naoIncorporado.plus(value)
      flags.add('TEM_OPERACAO_NAO_INCORPORADA')
    } else if (item.motivo === 'INCLUIDA_EM_TRANSITO') overlayEmTransito = overlayEmTransito.plus(value)
    else if (item.motivo === 'ENTREGUE') overlayEntregue = overlayEntregue.plus(value)
    else if (item.motivo === 'INDETERMINADA') {
      overlayIndeterminado = overlayIndeterminado.plus(value)
      flags.add('TEM_INDETERMINADA')
    }
  }
  const exposure = new Decimal(input.posicaoEmTransito).plus(overlayEmTransito)
  const pl = new Decimal(input.patrimonioLiquido)
  if (pl.lte(0)) throw new Error('PL_D2_INVALIDO')
  const exposurePercent = exposure.dividedBy(pl).times(100)
  return {
    overlayTotal: money(overlayTotal), overlayEmTransito: money(overlayEmTransito),
    overlayEntregue: money(overlayEntregue), overlayIndeterminado: money(overlayIndeterminado),
    operacoesJaIncorporadasValor: money(incorporado), operacoesNaoIncorporadasValor: money(naoIncorporado),
    exposicaoEmTransitoTotal: money(exposure), percentualExposicao: percent(exposurePercent),
    classificacaoLimite: classificarPercentualExposicao(exposurePercent.toString(), input.limite),
    flagsQualidade: [...flags].sort(),
  }
}
