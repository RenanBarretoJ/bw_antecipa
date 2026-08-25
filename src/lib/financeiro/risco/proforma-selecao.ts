import {
  calcularAntecipacaoEmLote,
  type MetodoCalculoFinanceiro,
  type TaxaPrazo,
} from '@/lib/operacoes/calculo'

export type ParcelaCandidataProforma = {
  id: string
  notaFiscalId: string
  valorNominal: number
  dataVencimento: string
}

export function calcularCandidatoParcelAware(input: {
  parcelasSelecionadas: ParcelaCandidataProforma[]
  taxas: TaxaPrazo[]
  dataBase: string
  metodo: MetodoCalculoFinanceiro | null
}) {
  if (input.parcelasSelecionadas.length === 0) {
    return {
      valorCandidato: null,
      quantidadeNfs: 0,
      quantidadeParcelas: 0,
    }
  }

  const calculo = calcularAntecipacaoEmLote({
    notas: input.parcelasSelecionadas.map((parcela) => ({
      id: parcela.id,
      valorBruto: parcela.valorNominal,
      vencimento: parcela.dataVencimento,
    })),
    taxas: input.taxas,
    dataBase: input.dataBase,
    metodo: input.metodo,
  })

  return {
    valorCandidato: calculo.valorLiquidoTotal,
    quantidadeNfs: new Set(input.parcelasSelecionadas.map((parcela) => parcela.notaFiscalId)).size,
    quantidadeParcelas: input.parcelasSelecionadas.length,
  }
}
