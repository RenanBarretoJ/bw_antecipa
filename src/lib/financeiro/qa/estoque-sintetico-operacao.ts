import Decimal from 'decimal.js'
import { ehDiaUtilAnbima } from '@/lib/operacoes/calculo'

export type ParcelaEstoqueQa = {
  parcelaId: string
  numeroParcela: number
  valorNominal: string
  valorAquisicao: string
  vencimento: string
  status: string
}

export type OperacaoEstoqueQa = {
  operacaoId: string
  fundoId: string
  fundoNome: string
  fundoCnpj: string
  numeroNf: string
  chaveNfe: string
  cedenteNome: string
  cedenteCnpj: string
  sacadoNome: string
  sacadoCnpj: string
  emissao: string
  aquisicao: string
  valorBrutoTotal: string
  precoAquisicao: string
  parcelas: ParcelaEstoqueQa[]
}

function dataCivil(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Data civil invalida: ${value}.`)
  const date = new Date(`${value}T12:00:00.000Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Data civil invalida: ${value}.`)
  return date
}

export function datasEstoqueQa(inicio: string, fim: string): string[] {
  const start = dataCivil(inicio)
  const end = dataCivil(fim)
  if (end < start) throw new Error('Data final anterior a cessao da operacao.')
  if ((end.valueOf() - start.valueOf()) / 86_400_000 > 60) throw new Error('Intervalo QA limitado a 60 dias civis.')
  const dates: string[] = []
  for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const iso = day.toISOString().slice(0, 10)
    if (ehDiaUtilAnbima(iso)) dates.push(iso)
  }
  if (!dates.length) throw new Error('Intervalo sem dia util ANBIMA.')
  return dates
}

function cell(value: string | number): string {
  const text = String(value)
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function validarOperacaoEstoqueQa(input: OperacaoEstoqueQa): void {
  if (!input.parcelas.length) throw new Error('Operacao sem parcelas selecionadas.')
  if (!/^\d{44}$/.test(input.chaveNfe)) throw new Error('NF da operacao sem chave de acesso valida para matching.')
  const ids = new Set(input.parcelas.map((parcela) => parcela.parcelaId))
  if (ids.size !== input.parcelas.length) throw new Error('Parcelas duplicadas na operacao.')
  if (input.parcelas.some((parcela) => parcela.status !== 'em_operacao')) throw new Error('Ha parcela com status diferente de em_operacao; revisar antes de simular o estoque.')
  const nominal = input.parcelas.reduce((sum, parcela) => sum.plus(parcela.valorNominal), new Decimal(0))
  const aquisicao = input.parcelas.reduce((sum, parcela) => sum.plus(parcela.valorAquisicao), new Decimal(0))
  if (!nominal.eq(input.valorBrutoTotal) || !aquisicao.eq(input.precoAquisicao)) {
    throw new Error('Soma das parcelas diverge dos totais persistidos na operacao.')
  }
}

export function gerarCsvEstoqueQa(input: OperacaoEstoqueQa, referencia: string): Uint8Array {
  validarOperacaoEstoqueQa(input)
  dataCivil(referencia)
  const headers = [
    'NOME_FUNDO', 'DOC_FUNDO', 'FUNDO_ID', 'NOME_CEDENTE', 'DOC_CEDENTE', 'NOME_SACADO',
    'DOC_SACADO', 'ID_RECEBIVEL', 'SEU_NUMERO', 'NU_DOCUMENTO', 'TIPO_RECEBIVEL', 'CHAVE_NFE',
    'VALOR_NOMINAL', 'VALOR_AQUISICAO', 'DATA_REFERENCIA', 'DATA_EMISSAO',
    'DATA_VENCIMENTO_ORIGINAL', 'DATA_AQUISICAO', 'SITUACAO_RECEBIVEL',
    'QA_OPERACAO_ID', 'QA_PARCELA_ID',
  ]
  const rows = input.parcelas.map((parcela) => {
    const identity = `QA-${input.operacaoId}-${parcela.parcelaId}`
    return [
      input.fundoNome, input.fundoCnpj, input.fundoId, input.cedenteNome, input.cedenteCnpj,
      input.sacadoNome, input.sacadoCnpj, identity, identity, input.numeroNf, 'NOTA_FISCAL', input.chaveNfe,
      parcela.valorNominal.replace('.', ','), parcela.valorAquisicao.replace('.', ','), referencia,
      input.emissao, parcela.vencimento, input.aquisicao, 'EM_ABERTO_QA', input.operacaoId, parcela.parcelaId,
    ]
  })
  return new TextEncoder().encode(`${[headers, ...rows].map((row) => row.map(cell).join(';')).join('\n')}\n`)
}
