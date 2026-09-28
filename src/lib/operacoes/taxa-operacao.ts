import Decimal from 'decimal.js'
import type { TaxaPrazo } from './calculo'

const TAXA_DECIMAL_PATTERN = /^\d+(?:[.,]\d+)?$/

export function normalizarTaxaOperacao(value: string | number): string | null {
  const raw = String(value).trim()
  if (!TAXA_DECIMAL_PATTERN.test(raw)) return null

  try {
    const decimal = new Decimal(raw.replace(',', '.'))
    if (!decimal.isFinite() || decimal.isNegative()) return null
    return decimal.toString()
  } catch {
    return null
  }
}

export function parseTaxaOperacao(value: string | number): number | null {
  const normalizada = normalizarTaxaOperacao(value)
  return normalizada === null ? null : new Decimal(normalizada).toNumber()
}

export function formatarTaxaOperacaoInput(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const normalizada = normalizarTaxaOperacao(value)
  return normalizada?.replace('.', ',') ?? ''
}

export function taxaMantemPropostaConsultor(
  taxaFinal: string | number,
  taxaProposta: string | number | null | undefined,
): boolean {
  if (taxaProposta === null || taxaProposta === undefined) return false
  const finalNormalizada = normalizarTaxaOperacao(taxaFinal)
  const propostaNormalizada = normalizarTaxaOperacao(taxaProposta)
  return finalNormalizada !== null
    && propostaNormalizada !== null
    && finalNormalizada === propostaNormalizada
}

export function taxaEstaConfiguradaParaPrazo(
  taxas: TaxaPrazo[],
  prazoReferencia: number,
  taxa: string | number,
): boolean {
  const normalizada = normalizarTaxaOperacao(taxa)
  if (normalizada === null) return false
  const decimalTaxa = new Decimal(normalizada)

  return taxas.some((item) => (
    prazoReferencia >= item.prazo_min
    && prazoReferencia <= item.prazo_max
    && new Decimal(item.taxa_percentual).equals(decimalTaxa)
  ))
}
