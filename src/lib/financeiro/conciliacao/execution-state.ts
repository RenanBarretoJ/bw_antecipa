export type EstadoExecucaoFinanceira =
  | 'SEM_EXECUCAO'
  | 'EXECUTADA'
  | 'EXECUTADA_SEM_MOVIMENTO'
  | 'BASE_INCOMPLETA'
  | 'HISTORICA_NAO_APLICAVEL'
  | 'PROCESSANDO'
  | 'ERRO'

type ExecucaoClassificavel = { status: string } | null

export function totalDeContagens(contagens: Record<string, number>): number {
  return Object.values(contagens).reduce((total, quantidade) => total + Number(quantidade || 0), 0)
}

export function classificarEstadoExecucaoFinanceira(input: {
  atual: ExecucaoClassificavel
  anterior?: ExecucaoClassificavel
  totalRegistros?: number | null
}): EstadoExecucaoFinanceira {
  if (!input.atual) return input.anterior ? 'HISTORICA_NAO_APLICAVEL' : 'SEM_EXECUCAO'
  if (input.atual.status === 'BASE_INCOMPLETA') return 'BASE_INCOMPLETA'
  if (input.atual.status === 'FALHA') return 'ERRO'
  if (input.atual.status === 'PROCESSANDO') return 'PROCESSANDO'
  if (input.atual.status === 'CONCLUIDA' && input.totalRegistros === 0) return 'EXECUTADA_SEM_MOVIMENTO'
  return 'EXECUTADA'
}

export function rotuloEstadoExecucaoFinanceira(estado: EstadoExecucaoFinanceira): string {
  const rotulos: Record<EstadoExecucaoFinanceira, string> = {
    SEM_EXECUCAO: 'Não executado',
    EXECUTADA: 'Executado',
    EXECUTADA_SEM_MOVIMENTO: 'Executado — sem movimento',
    BASE_INCOMPLETA: 'Base incompleta',
    HISTORICA_NAO_APLICAVEL: 'Histórico — não aplicável à data selecionada',
    PROCESSANDO: 'Em processamento',
    ERRO: 'Erro',
  }
  return rotulos[estado]
}
