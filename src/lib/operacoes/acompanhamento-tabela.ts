import { valorBaseSnapshot } from './base-antecipacao'
import type { OperacaoCedenteDetalhe } from './cedente-detalhe'
import { selecionarLinhasParcelas, type LinhaParcelaOperacao, type OrdemParcelas } from './parcelas-tabela'

export interface LinhaAcompanhamento extends LinhaParcelaOperacao {
  href: string
  statusLabel: string
  prazoDias: number | null
  desconto: number | null
  statusFinanceiro: string | null
  parcelasCedidasNaNf: number
  totalParcelasNaNf: number
}

export function construirLinhasAcompanhamento(detalhe: Pick<OperacaoCedenteDetalhe, 'notasFiscais' | 'baseAntecipacaoSnapshot'>): LinhaAcompanhamento[] {
  return detalhe.notasFiscais.flatMap<LinhaAcompanhamento>(nf => {
    const identidade = {
      notaFiscalId: nf.id, numeroNf: nf.numero, sacado: nf.sacado, cnpjSacado: nf.cnpjSacado ?? '',
      brutoFiscal: nf.valorBrutoFiscal, statusNf: nf.status, statusLabel: nf.statusLabel, href: nf.href,
      parcelasCedidasNaNf: nf.parcelasCedidas.length, totalParcelasNaNf: nf.totalParcelas,
    }
    if (nf.parcelasCedidas.length) {
      return nf.parcelasCedidas.map(parcela => ({
        ...identidade, id: `${nf.id}:${parcela.parcelaId}`, parcelaId: parcela.parcelaId,
        numeroParcela: parcela.numero, vencimento: parcela.vencimentoOriginal,
        baseCedida: valorBaseSnapshot(detalhe.baseAntecipacaoSnapshot, nf.id, parcela.valorNominal, parcela.parcelaId),
        antecipado: parcela.valorAntecipado, prazoDias: parcela.prazoDias,
        desconto: parcela.desconto, statusFinanceiro: parcela.statusFinanceiro,
      }))
    }
    // Não reapresentar uma NF parcelada inteira quando não há parcelas cedidas.
    if (nf.totalParcelas > 0) return []
    return [{
      ...identidade, id: nf.id, parcelaId: null, numeroParcela: null,
      vencimento: nf.vencimento,
      baseCedida: valorBaseSnapshot(detalhe.baseAntecipacaoSnapshot, nf.id, nf.valorBrutoFiscal),
      antecipado: nf.valorAntecipado, prazoDias: null, desconto: null, statusFinanceiro: null,
    }]
  })
}

export function paginarAcompanhamento({ linhas, busca = '', status = '', ordem = 'vencimento', pagina = 1, tamanho = 25 }: {
  linhas: readonly LinhaAcompanhamento[]
  busca?: string
  status?: string
  ordem?: OrdemParcelas
  pagina?: number
  tamanho?: number
}) {
  const porId = new Map(linhas.map(linha => [linha.id, linha]))
  const filtradas = selecionarLinhasParcelas(linhas, busca, 'todas', ordem, false)
    .filter(linha => !status || linha.statusNf === status)
    .map(linha => porId.get(linha.id)!)
  const tamanhoSeguro = Number.isFinite(tamanho) ? Math.max(1, Math.min(100, Math.trunc(tamanho))) : 25
  const paginas = Math.max(1, Math.ceil(filtradas.length / tamanhoSeguro))
  const atual = Number.isFinite(pagina) ? Math.min(paginas, Math.max(1, Math.trunc(pagina))) : 1
  return { filtradas, itens: filtradas.slice((atual - 1) * tamanhoSeguro, atual * tamanhoSeguro), atual, paginas }
}
