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

export function calcularAntecipacaoEmLote(input: {
  notas: NotaCalculoAntecipacao[]
  taxas: TaxaPrazo[]
  agoraMs: number
}) {
  const notas = input.notas.map((nota) => {
    const prazoDias = Math.max(1, Math.ceil(
      (new Date(`${nota.vencimento}T12:00:00`).getTime() - input.agoraMs) / 86_400_000,
    ))
    const taxa = input.taxas.find((item) => (
      prazoDias >= item.prazo_min && prazoDias <= item.prazo_max
    ))?.taxa_percentual || 0
    const fator = Math.pow(1 + taxa / 100, prazoDias / 30)
    const valorAntecipado = Math.round((nota.valorBruto / fator) * 100) / 100
    return { ...nota, prazoDias, taxa, valorAntecipado }
  })
  const valorBrutoTotal = notas.reduce((total, nota) => total + nota.valorBruto, 0)
  const valorLiquidoTotal = notas.reduce((total, nota) => total + nota.valorAntecipado, 0)
  const taxaMedia = valorBrutoTotal > 0
    ? notas.reduce((total, nota) => total + nota.taxa * nota.valorBruto, 0) / valorBrutoTotal
    : 0
  const prazoMedio = valorBrutoTotal > 0
    ? Math.round(notas.reduce((total, nota) => total + nota.prazoDias * nota.valorBruto, 0) / valorBrutoTotal)
    : 0
  return { notas, valorBrutoTotal, valorLiquidoTotal, taxaMedia, prazoMedio }
}
