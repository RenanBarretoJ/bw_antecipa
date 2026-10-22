import type { ConciliacaoDashboard } from '@/lib/financeiro/conciliacao/loaders.server'
import type { FilaConciliacao } from '@/lib/navigation/conciliacao'

type ExecutionSummary = Pick<NonNullable<ConciliacaoDashboard['conciliacaoExecucao']>, 'status'> | null
export type PendingWorkqueuesData = Pick<ConciliacaoDashboard, 'erros'> & {
  filtros: Pick<ConciliacaoDashboard['filtros'], 'tab' | 'dataReferencia' | 'fila'>
  matchingExecucao: ExecutionSummary
  conciliacaoExecucao: ExecutionSummary
  logisticaExecucao: ExecutionSummary
  riscoExecucao: Pick<NonNullable<ConciliacaoDashboard['riscoExecucao']>, 'decisao' | 'aplicavel'> | null
  matching: { total: number }
  conciliacao: { total: number }
  logistica: { total: number }
}

export function estadoFilaConciliacao(dashboard: PendingWorkqueuesData, fila: FilaConciliacao) {
  const execution = fila === 'matching' ? dashboard.matchingExecucao : fila === 'conciliacao' ? dashboard.conciliacaoExecucao : dashboard.logisticaExecucao
  if (dashboard.erros[fila]) return { verificada: false, quantidade: null, label: 'Não foi possível conferir esta fila' }
  if (!execution) return { verificada: false, quantidade: null, label: 'Ainda não verificada nesta data' }
  if (execution.status !== 'CONCLUIDA') return { verificada: false, quantidade: null, label: execution.status === 'BASE_INCOMPLETA' ? 'Bases incompletas' : 'Execução ainda não concluída' }
  const quantidade = dashboard[fila].total
  return { verificada: true, quantidade, label: quantidade ? `${quantidade} ocorrência(s)` : 'Nenhuma ocorrência nesta fila' }
}

export function totalFilaConciliacao(dashboard: PendingWorkqueuesData) {
  return dashboard.filtros.fila ? dashboard[dashboard.filtros.fila].total : 0
}
