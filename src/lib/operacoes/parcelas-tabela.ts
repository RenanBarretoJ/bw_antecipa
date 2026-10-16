import { valorBaseSnapshot, type BaseAntecipacaoSnapshot } from './base-antecipacao'

export interface ParcelaCedidaOperacao {
  parcelaId: string
  numeroParcela: number
  dataVencimento: string
  valorNominal: number
  diasAplicados: number | null
  valorPresente: number | null
  desconto: number | null
}

interface NotaTabela {
  id: string
  numero_nf: string
  razao_social_destinatario: string
  cnpj_destinatario: string
  valor_bruto: number
  valor_liquido: number
  valor_antecipado: number | null
  data_vencimento: string
  status: string
}

export interface LinhaParcelaOperacao {
  id: string
  notaFiscalId: string
  numeroNf: string
  parcelaId: string | null
  numeroParcela: number | null
  sacado: string
  cnpjSacado: string
  brutoFiscal: number
  baseCedida: number
  antecipado: number | null
  vencimento: string
  statusNf: string
}

export function construirLinhasParcelasOperacao({
  notas, parcelasPorNf, totalParcelasPorNf, snapshot, memoriasLegadas, historico,
}: {
  notas: readonly NotaTabela[]
  parcelasPorNf: ReadonlyMap<string, readonly ParcelaCedidaOperacao[]>
  totalParcelasPorNf: ReadonlyMap<string, number>
  snapshot: BaseAntecipacaoSnapshot | null | undefined
  memoriasLegadas: readonly { nota_fiscal_id: string; parcela_id: string | null; valor_presente: number }[]
  historico: boolean
}): LinhaParcelaOperacao[] {
  const memoriaLegadaPorNf = new Map(memoriasLegadas.filter(m => m.parcela_id === null).map(m => [m.nota_fiscal_id, m]))
  return notas.flatMap<LinhaParcelaOperacao>(nf => {
    const identidade = { notaFiscalId: nf.id, numeroNf: nf.numero_nf, sacado: nf.razao_social_destinatario,
      cnpjSacado: nf.cnpj_destinatario, brutoFiscal: nf.valor_bruto, statusNf: nf.status }
    const parcelas = parcelasPorNf.get(nf.id) ?? []
    if (parcelas.length) {
      return parcelas.map(p => ({ ...identidade, id: `${nf.id}:${p.parcelaId}`, parcelaId: p.parcelaId,
        numeroParcela: p.numeroParcela, vencimento: p.dataVencimento,
        baseCedida: valorBaseSnapshot(snapshot, nf.id, p.valorNominal, p.parcelaId), antecipado: p.valorPresente }))
    }
    // Uma NF parcelada sem vínculo ativo não pode reaparecer pelo valor integral.
    if ((totalParcelasPorNf.get(nf.id) ?? 0) > 0) return []
    return [{ ...identidade, id: nf.id, parcelaId: null, numeroParcela: null, vencimento: nf.data_vencimento,
      baseCedida: valorBaseSnapshot(snapshot, nf.id, nf.valor_bruto),
      antecipado: memoriaLegadaPorNf.get(nf.id)?.valor_presente ?? (historico ? nf.valor_antecipado ?? nf.valor_liquido : null) }]
  })
}

export function totaisLinhasParcelas(linhas: readonly LinhaParcelaOperacao[]) {
  const notas = new Map(linhas.map(l => [l.notaFiscalId, l.brutoFiscal]))
  const somar = (valores: readonly number[]) => valores.reduce((s, v) => s + Math.round(v * 100), 0) / 100
  return {
    notas: notas.size,
    brutoFiscal: somar([...notas.values()]),
    baseCedida: somar(linhas.map(l => l.baseCedida)),
    antecipado: linhas.some(l => l.antecipado === null) ? null : somar(linhas.map(l => l.antecipado ?? 0)),
  }
}

export type OrdemParcelas = 'vencimento' | 'numero' | 'sacado' | 'valor' | 'status'
export type FiltroParcelas = 'todas' | 'pendentes' | 'contestadas'

export function selecionarLinhasParcelas(linhas: readonly LinhaParcelaOperacao[], busca: string, filtro: FiltroParcelas, ordem: OrdemParcelas, aceiteExigido: boolean) {
  const termo = busca.trim().toLocaleLowerCase('pt-BR')
  return linhas.filter(l => `${l.numeroNf} ${l.sacado} ${l.cnpjSacado}`.toLocaleLowerCase('pt-BR').includes(termo))
    .filter(l => filtro === 'todas' || (filtro === 'contestadas' ? l.statusNf === 'contestada' : aceiteExigido && !['aceita', 'contestada'].includes(l.statusNf)))
    .sort((a, b) => {
      const comparacao = ordem === 'valor' ? b.baseCedida - a.baseCedida
        : ordem === 'numero' ? a.numeroNf.localeCompare(b.numeroNf, 'pt-BR', { numeric: true })
          : ordem === 'sacado' ? a.sacado.localeCompare(b.sacado, 'pt-BR')
            : ordem === 'status' ? a.statusNf.localeCompare(b.statusNf) : a.vencimento.localeCompare(b.vencimento)
      return comparacao || a.numeroNf.localeCompare(b.numeroNf, 'pt-BR', { numeric: true }) || (a.numeroParcela ?? 0) - (b.numeroParcela ?? 0)
    })
}
