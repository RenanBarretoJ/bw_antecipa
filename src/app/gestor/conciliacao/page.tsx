import { carregarConciliacaoGestor, type ConciliacaoFilters } from '@/lib/financeiro/conciliacao/loaders.server'
import { resolverNavegacaoConciliacao } from '@/lib/navigation/conciliacao'
import { ConciliacaoFinanceiraClient } from './conciliacao-financeira-client'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export default async function ConciliacaoPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const navigation = resolverNavegacaoConciliacao(single(params.tab), single(params.detalhe), single(params.fila))
  const filters: ConciliacaoFilters = {
    ...navigation,
    dataReferencia: single(params.data),
    status: single(params.status),
    metodo: single(params.metodo),
    q: single(params.q),
    cedente: single(params.cedente),
    sacado: single(params.sacado),
    notaFiscal: single(params.nf),
    seuNumero: single(params.seuNumero),
    idRecebivel: single(params.idRecebivel),
    vencimentoDe: single(params.vencimentoDe),
    vencimentoAte: single(params.vencimentoAte),
    riskReason: single(params.motivo),
    riskOperation: single(params.operacao),
    riskPolicy: single(params.politica),
    riskCreatedFrom: single(params.dataDe),
    riskCreatedTo: single(params.dataAte),
    page: positiveInteger(single(params.page), 1),
    pageSize: Math.min(50, positiveInteger(single(params.pageSize), 20)),
  }
  const dashboard = await carregarConciliacaoGestor(filters)
  return <ConciliacaoFinanceiraClient dashboard={dashboard} />
}
