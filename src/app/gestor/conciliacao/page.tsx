import { carregarConciliacaoGestor, type ConciliacaoFilters, type ConciliacaoTab } from '@/lib/rlx/conciliacao/loaders.server'
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
  const rawTab = single(params.tab)
  const tab: ConciliacaoTab = ['matching', 'conciliacao', 'logistica', 'excecoes'].includes(rawTab)
    ? rawTab as ConciliacaoTab
    : 'visao-geral'
  const filters: ConciliacaoFilters = {
    tab,
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
    page: positiveInteger(single(params.page), 1),
    pageSize: Math.min(50, positiveInteger(single(params.pageSize), 20)),
  }
  const dashboard = await carregarConciliacaoGestor(filters)
  return <ConciliacaoFinanceiraClient dashboard={dashboard} />
}
