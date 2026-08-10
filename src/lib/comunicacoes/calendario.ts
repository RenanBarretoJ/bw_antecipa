import { ehDiaUtilAnbima } from '@/lib/operacoes/calculo'

const DIA_MS = 86_400_000

function parseDataCivil(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`Data civil invalida: ${value}.`)
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (new Date(utc).toISOString().slice(0, 10) !== value) throw new Error(`Data civil invalida: ${value}.`)
  return utc
}
export function adicionarDiasCivis(value: string, dias: number): string {
  return new Date(parseDataCivil(value) + dias * DIA_MS).toISOString().slice(0, 10)
}

export function diferencaDiasCivis(dataBase: string, dataFinal: string): number {
  return Math.round((parseDataCivil(dataFinal) - parseDataCivil(dataBase)) / DIA_MS)
}

export function diaUtilAnteriorOuIgual(value: string): string {
  let cursor = value
  while (!ehDiaUtilAnbima(cursor)) cursor = adicionarDiasCivis(cursor, -1)
  return cursor
}

export function proximoDiaUtilOuIgual(value: string): string {
  let cursor = value
  while (!ehDiaUtilAnbima(cursor)) cursor = adicionarDiasCivis(cursor, 1)
  return cursor
}

export function ajustarDataEnvio(dataNominal: string, offset: number) {
  if (ehDiaUtilAnbima(dataNominal)) return { dataEfetiva: dataNominal, motivoAjuste: null }
  const dataEfetiva = offset < 0
    ? diaUtilAnteriorOuIgual(dataNominal)
    : proximoDiaUtilOuIgual(dataNominal)
  return {
    dataEfetiva,
    motivoAjuste: offset < 0
      ? 'antecipada_para_dia_util_anterior'
      : 'postergada_para_proximo_dia_util',
  }
}

export function dataCivilSaoPaulo(instant = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
