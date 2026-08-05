import Decimal from 'decimal.js'

export const METODOS_CALCULO_NOVAS_POLITICAS = [
  'DIAS_UTEIS_252',
  'TRINTA_360',
  'DIAS_CORRIDOS_365',
] as const

export type MetodoCalculoNovaPolitica = typeof METODOS_CALCULO_NOVAS_POLITICAS[number]
export type MetodoCalculoFinanceiro = MetodoCalculoNovaPolitica | 'LEGADO_MENSAL_DIAS_REAIS_30'

export const CALCULO_FINANCEIRO_VERSAO_MOTOR = 1
export const CALCULO_FINANCEIRO_ARREDONDAMENTO = 'ROUND_HALF_UP_2_CASAS' as const

export const METODOS_CALCULO_LABELS: Record<MetodoCalculoFinanceiro, string> = {
  LEGADO_MENSAL_DIAS_REAIS_30: 'Legado - dias reais / 30',
  DIAS_UTEIS_252: '252 - Dias uteis',
  TRINTA_360: '360 - Dias corridos',
  DIAS_CORRIDOS_365: '365 - Dias corridos',
}

export function criarConfiguracaoCalculoSnapshot(metodoInput?: string | null) {
  const metodo = resolverMetodoCalculo(metodoInput)
  return {
    metodo,
    descricao: METODOS_CALCULO_LABELS[metodo],
    base: metodo === 'DIAS_UTEIS_252' ? 252 : metodo === 'TRINTA_360' ? 360 : metodo === 'DIAS_CORRIDOS_365' ? 365 : 30,
    periodo_taxa: 'mensal',
    divisor_mensal: metodo === 'DIAS_UTEIS_252' ? 21 : metodo === 'DIAS_CORRIDOS_365' ? null : 30,
    unidade_contagem: metodo === 'DIAS_UTEIS_252' ? 'dias_uteis' : metodo === 'TRINTA_360' ? 'dias_financeiros' : 'dias_corridos',
    calendario: metodo === 'DIAS_UTEIS_252' ? 'ANBIMA' : null,
    convencao: metodo === 'TRINTA_360' ? 'DIA_MIN_30' : null,
    versao_motor: CALCULO_FINANCEIRO_VERSAO_MOTOR,
    arredondamento: CALCULO_FINANCEIRO_ARREDONDAMENTO,
  } as const
}

export type TaxaPrazo = {
  prazo_min: number
  prazo_max: number
  taxa_percentual: number
}

export type NotaCalculoAntecipacao = {
  id: string
  valorBruto: number
  vencimento: string
}

export class CalculoFinanceiroError extends Error {
  constructor(message: string, readonly code: 'NF_VENCIDA' | 'DATA_INVALIDA' | 'TAXA_INVALIDA' | 'METODO_INVALIDO') {
    super(message)
    this.name = 'CalculoFinanceiroError'
  }
}

const DIA_MS = 86_400_000
const FERIADOS_ANBIMA_CACHE = new Map<number, Set<string>>()

function parseDataCivil(value: string): { ano: number; mes: number; dia: number; utc: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new CalculoFinanceiroError(`Data civil invalida: ${value}.`, 'DATA_INVALIDA')
  const ano = Number(match[1])
  const mes = Number(match[2])
  const dia = Number(match[3])
  const utc = Date.UTC(ano, mes - 1, dia)
  const parsed = new Date(utc)
  if (parsed.getUTCFullYear() !== ano || parsed.getUTCMonth() !== mes - 1 || parsed.getUTCDate() !== dia) {
    throw new CalculoFinanceiroError(`Data civil invalida: ${value}.`, 'DATA_INVALIDA')
  }
  return { ano, mes, dia, utc }
}

function formatUtcDate(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10)
}

function addDays(value: string, days: number): string {
  return formatUtcDate(parseDataCivil(value).utc + days * DIA_MS)
}

function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Calendario nacional publicado pela ANBIMA. A lista e materializada por ano e
 * mantida em cache. O dia 20/11 passou a constar no calendario nacional a partir
 * de 2024; essa diferenca corrige a lista simplificada encontrada no SC1.
 */
export function feriadosAnbimaDoAno(year: number): ReadonlySet<string> {
  const cached = FERIADOS_ANBIMA_CACHE.get(year)
  if (cached) return cached
  const easter = easterSunday(year)
  const holidays = new Set([
    `${year}-01-01`,
    addDays(easter, -48),
    addDays(easter, -47),
    addDays(easter, -2),
    `${year}-04-21`,
    `${year}-05-01`,
    addDays(easter, 60),
    `${year}-09-07`,
    `${year}-10-12`,
    `${year}-11-02`,
    `${year}-11-15`,
    `${year}-12-25`,
  ])
  if (year >= 2024) holidays.add(`${year}-11-20`)
  FERIADOS_ANBIMA_CACHE.set(year, holidays)
  return holidays
}

export function ehDiaUtilAnbima(value: string): boolean {
  const date = parseDataCivil(value)
  const weekDay = new Date(date.utc).getUTCDay()
  return weekDay !== 0 && weekDay !== 6 && !feriadosAnbimaDoAno(date.ano).has(value)
}

export function proximoDiaUtilAnbima(value: string): string {
  let cursor = value
  do cursor = addDays(cursor, 1)
  while (!ehDiaUtilAnbima(cursor))
  return cursor
}

export function contarDiasUteisAnbima(dataBase: string, dataFinal: string): number {
  const start = parseDataCivil(dataBase).utc
  const end = parseDataCivil(dataFinal).utc
  if (end < start) return -1
  let total = 0
  for (let cursor = start + DIA_MS; cursor <= end; cursor += DIA_MS) {
    if (ehDiaUtilAnbima(formatUtcDate(cursor))) total += 1
  }
  return total
}

export function contarDiasCorridos(dataBase: string, vencimento: string): number {
  return Math.round((parseDataCivil(vencimento).utc - parseDataCivil(dataBase).utc) / DIA_MS)
}

export function contarDiasTrinta360(dataBase: string, vencimento: string): number {
  const inicio = parseDataCivil(dataBase)
  const fim = parseDataCivil(vencimento)
  return 360 * (fim.ano - inicio.ano)
    + 30 * (fim.mes - inicio.mes)
    + (Math.min(fim.dia, 30) - Math.min(inicio.dia, 30))
}

export function resolverMetodoCalculo(metodo?: string | null): MetodoCalculoFinanceiro {
  if (metodo === null || metodo === undefined || metodo === '') return 'LEGADO_MENSAL_DIAS_REAIS_30'
  if (metodo === 'LEGADO_MENSAL_DIAS_REAIS_30') return metodo
  if (METODOS_CALCULO_NOVAS_POLITICAS.includes(metodo as MetodoCalculoNovaPolitica)) {
    return metodo as MetodoCalculoNovaPolitica
  }
  throw new CalculoFinanceiroError('Metodo de calculo financeiro invalido.', 'METODO_INVALIDO')
}

export type MemoriaCalculoNota = {
  notaFiscalId: string
  valorNominal: number
  taxaMensal: number | null
  dataBase: string
  vencimentoContratual: string
  vencimentoConsideradoCalculo: string
  metodo: MetodoCalculoFinanceiro
  base: 30 | 252 | 360 | 365
  calendario: 'ANBIMA' | null
  diasCorridosReais: number
  diasUteis: number | null
  diasFinanceiros: number | null
  dias: number
  expoente: number
  fator: number | null
  valorPresente: number | null
  desconto: number | null
  arredondamento: typeof CALCULO_FINANCEIRO_ARREDONDAMENTO
  versaoMotor: number
}

export function calcularValorPresenteNota(input: {
  notaFiscalId: string
  valorNominal: number
  taxaMensal: number | null
  dataBase: string
  vencimento: string
  metodo?: string | null
}): MemoriaCalculoNota {
  const metodo = resolverMetodoCalculo(input.metodo)
  const diasCorridosReais = contarDiasCorridos(input.dataBase, input.vencimento)
  if (diasCorridosReais < 0) {
    throw new CalculoFinanceiroError('A NF esta vencida e nao pode ser incluida na operacao.', 'NF_VENCIDA')
  }
  if (!Number.isFinite(input.valorNominal) || input.valorNominal <= 0) {
    throw new CalculoFinanceiroError('Valor nominal invalido.', 'TAXA_INVALIDA')
  }
  if (input.taxaMensal !== null && (!Number.isFinite(input.taxaMensal) || input.taxaMensal < 0)) {
    throw new CalculoFinanceiroError('Taxa mensal invalida.', 'TAXA_INVALIDA')
  }

  let vencimentoConsideradoCalculo = input.vencimento
  let dias = diasCorridosReais
  let diasUteis: number | null = null
  let diasFinanceiros: number | null = null
  let base: MemoriaCalculoNota['base'] = 30
  let calendario: MemoriaCalculoNota['calendario'] = null
  let expoente = dias / 30

  if (metodo === 'DIAS_UTEIS_252') {
    if (!ehDiaUtilAnbima(vencimentoConsideradoCalculo)) {
      vencimentoConsideradoCalculo = proximoDiaUtilAnbima(vencimentoConsideradoCalculo)
    }
    diasUteis = contarDiasUteisAnbima(input.dataBase, vencimentoConsideradoCalculo)
    dias = diasUteis
    expoente = dias / 21
    base = 252
    calendario = 'ANBIMA'
  } else if (metodo === 'TRINTA_360') {
    diasFinanceiros = contarDiasTrinta360(input.dataBase, input.vencimento)
    dias = diasFinanceiros
    expoente = dias / 30
    base = 360
  } else if (metodo === 'DIAS_CORRIDOS_365') {
    expoente = 12 * dias / 365
    base = 365
  }

  let fator: number | null = null
  let valorPresente: number | null = null
  let desconto: number | null = null
  if (input.taxaMensal !== null) {
    const decimalTax = new Decimal(input.taxaMensal).div(100)
    const decimalFactor = Decimal.add(1, decimalTax).pow(expoente)
    const decimalPresentValue = new Decimal(input.valorNominal)
      .div(decimalFactor)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    fator = decimalFactor.toNumber()
    valorPresente = decimalPresentValue.toNumber()
    desconto = new Decimal(input.valorNominal).minus(decimalPresentValue)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
  }

  return {
    notaFiscalId: input.notaFiscalId,
    valorNominal: input.valorNominal,
    taxaMensal: input.taxaMensal,
    dataBase: input.dataBase,
    vencimentoContratual: input.vencimento,
    vencimentoConsideradoCalculo,
    metodo,
    base,
    calendario,
    diasCorridosReais,
    diasUteis,
    diasFinanceiros,
    dias,
    expoente,
    fator,
    valorPresente,
    desconto,
    arredondamento: CALCULO_FINANCEIRO_ARREDONDAMENTO,
    versaoMotor: CALCULO_FINANCEIRO_VERSAO_MOTOR,
  }
}

export function selecionarTaxaUnica(taxas: TaxaPrazo[], prazoReferencia: number): number | null {
  const faixa = [...taxas]
    .sort((left, right) => left.prazo_min - right.prazo_min || left.prazo_max - right.prazo_max)
    .find((item) => prazoReferencia >= item.prazo_min && prazoReferencia <= item.prazo_max)
  return faixa ? faixa.taxa_percentual : null
}

export function calcularAntecipacaoEmLote(input: {
  notas: NotaCalculoAntecipacao[]
  taxas?: TaxaPrazo[]
  taxaMensal?: number | null
  dataBase: string
  metodo?: string | null
}) {
  const preliminares = input.notas.map((nota) => calcularValorPresenteNota({
    notaFiscalId: nota.id,
    valorNominal: nota.valorBruto,
    taxaMensal: null,
    dataBase: input.dataBase,
    vencimento: nota.vencimento,
    metodo: input.metodo,
  }))
  const prazoReferencia = preliminares.reduce((max, item) => Math.max(max, item.dias), 0)
  const taxaMensal = input.taxaMensal !== undefined
    ? input.taxaMensal
    : selecionarTaxaUnica(input.taxas || [], prazoReferencia)
  const memorias = input.notas.map((nota) => calcularValorPresenteNota({
    notaFiscalId: nota.id,
    valorNominal: nota.valorBruto,
    taxaMensal,
    dataBase: input.dataBase,
    vencimento: nota.vencimento,
    metodo: input.metodo,
  }))
  const valorBrutoTotal = memorias.reduce(
    (total, item) => total.plus(item.valorNominal),
    new Decimal(0),
  ).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
  const valorLiquidoTotal = taxaMensal === null ? null : memorias.reduce(
    (total, item) => total.plus(item.valorPresente ?? 0), new Decimal(0),
  ).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
  const descontoTotal = valorLiquidoTotal === null ? null : new Decimal(valorBrutoTotal)
    .minus(valorLiquidoTotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
  const prazoMedio = valorBrutoTotal > 0
    ? memorias.reduce(
        (total, item) => total.plus(new Decimal(item.dias).times(item.valorNominal)),
        new Decimal(0),
      ).div(valorBrutoTotal).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber()
    : 0
  return {
    notas: memorias,
    metodo: resolverMetodoCalculo(input.metodo),
    taxaMensal,
    taxaConfigurada: taxaMensal !== null,
    valorBrutoTotal,
    valorLiquidoTotal,
    descontoTotal,
    taxaMedia: taxaMensal,
    prazoMedio,
  }
}
