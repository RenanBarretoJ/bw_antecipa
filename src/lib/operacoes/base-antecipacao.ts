/** Fiscal value selection only. Pricing and day-count remain in calculo.ts (P17). */
export type BaseValorAntecipacao = 'BRUTO' | 'LIQUIDO'

export interface ValoresFiscaisAntecipacao {
  valorBruto: number
  valorLiquido: number | null
  origemLiquido: string | null
  possuiParcelas: boolean
}

export type BaseAntecipacaoResolvida =
  | { elegivel: true; base: BaseValorAntecipacao; valorBase: number }
  | { elegivel: false; motivo: string }

export function resolverBaseAntecipacao(
  base: BaseValorAntecipacao,
  nota: ValoresFiscaisAntecipacao,
): BaseAntecipacaoResolvida {
  if (base !== 'BRUTO' && base !== 'LIQUIDO') {
    return { elegivel: false, motivo: 'Base de antecipação não configurada para o vínculo.' }
  }
  if (!Number.isFinite(nota.valorBruto) || nota.valorBruto <= 0) {
    return { elegivel: false, motivo: 'A nota não possui valor bruto fiscal válido.' }
  }
  if (base === 'BRUTO') return { elegivel: true, base, valorBase: nota.valorBruto }
  if (nota.possuiParcelas) {
    return { elegivel: false, motivo: 'Antecipação pelo valor líquido indisponível para notas parceladas.' }
  }
  if (nota.origemLiquido !== 'DOCUMENTO_EXPLICITO' || nota.valorLiquido === null
    || !Number.isFinite(nota.valorLiquido) || nota.valorLiquido <= 0
    || nota.valorLiquido > nota.valorBruto) {
    return { elegivel: false, motivo: 'A antecipação pelo líquido exige valor positivo explicitamente informado no documento.' }
  }
  return { elegivel: true, base, valorBase: nota.valorLiquido }
}

export interface BaseAntecipacaoNotaSnapshot {
  nota_fiscal_id: string
  valor_bruto_fiscal: number
  valor_liquido_fiscal: number | null
  valor_liquido_origem: string | null
  valor_base: number
}

export interface BaseAntecipacaoSnapshot {
  schema: 'bw-antecipa.base-antecipacao.v1'
  base: BaseValorAntecipacao
  cedente_id: string
  fundo_id: string
  cedente_fundo_id: string
  politica_operacional_versao_id: string
  capturado_em: string
  notas: BaseAntecipacaoNotaSnapshot[]
  itens: Array<{ nota_fiscal_id: string; parcela_id: string | null; valor_base: number; vencimento: string }>
}

/** Null identifies pre-A5 operations explicitly; never consult the live policy. */
export function valorBaseSnapshot(
  snapshot: BaseAntecipacaoSnapshot | null | undefined,
  notaFiscalId: string,
  valorLegado: number,
  parcelaId: string | null = null,
): number {
  if (snapshot == null) return valorLegado
  const item = snapshot.itens.find((entry) => entry.nota_fiscal_id === notaFiscalId && entry.parcela_id === parcelaId)
  if (!item || !Number.isFinite(item.valor_base) || item.valor_base <= 0) {
    throw new Error('A operação não possui base de antecipação congelada para este item.')
  }
  return item.valor_base
}
