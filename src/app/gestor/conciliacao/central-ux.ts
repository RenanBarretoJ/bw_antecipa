import type { ConciliacaoTab } from '@/lib/financeiro/conciliacao/loaders.server'
import type { BaseFinanceiraDaData, BaseFinanceiraResolvida } from '@/lib/financeiro/conciliacao/base-financeira'
import { basesObrigatoriasConciliacao, diagnosticoCompativel, baseMovimentoDispensada } from '@/lib/financeiro/conciliacao/movimentos-condicionais'

export type ConciliacaoSubtab = {
  id: ConciliacaoTab
  label: string
  description: string
  detail?: string
  formula?: string
}

export const CONCILIACAO_SUBTABS: ConciliacaoSubtab[] = [
  {
    id: 'visao-geral',
    label: 'Resumo',
    description: 'Resume a disponibilidade das bases e o estado das execuções para a data operacional selecionada.',
  },
  {
    id: 'matching',
    label: 'Vínculo Título × NF',
    description: 'Relaciona os títulos financeiros das bases do fundo às Notas Fiscais cadastradas na plataforma.',
    detail: 'Os métodos exibidos identificam a chave utilizada no vínculo, sem alterar a prioridade do matching.',
  },
  {
    id: 'conciliacao',
    label: 'Conciliação Financeira',
    description: 'Verifica se a movimentação entre D-2 e D-1 é coerente, considerando aquisições e liquidações do período.',
    formula: 'Estoque D-2 + Aquisições D-1 - Liquidações D-1 ≈ Estoque D-1',
    detail: 'Esta é uma reconciliação operacional e não representa o saldo contábil definitivo do fundo.',
  },
  {
    id: 'logistica',
    label: 'Posição Logística',
    description: 'Classifica os títulos do estoque conforme as evidências logísticas aprovadas, como CT-e e comprovante de entrega.',
  },
  {
    id: 'exposicao',
    label: 'Exposição em Trânsito',
    description: 'Calcula o valor conhecido em trânsito e sua representatividade sobre o PL de referência.',
  },
  {
    id: 'risco',
    label: 'Gate de Risco',
    description: 'Aplica a política vigente do fundo sobre a exposição calculada e determina a condição operacional.',
  },
  {
    id: 'excecoes',
    label: 'Pendências',
    description: 'Consolida situações que exigem atenção ou intervenção operacional nas etapas anteriores.',
    detail: 'As filas de vínculo, movimentações e logística são consultadas separadamente, sem somar ocorrências como títulos únicos. O Gate de Risco possui tratamento próprio na seção Exposição e Risco.',
  },
]

type BaseComLabel = {
  label: string
  base: BaseFinanceiraResolvida
}

export type ResumoBaseFinanceira = {
  tone: 'success' | 'warning' | 'default'
  message: string
}

export function resumirResultadosConciliacao(contagens: Record<string, number>) {
  const corretos = ['MANTIDO_CORRETO', 'ENTRADA_INCORPORADA', 'SAIDA_REFLETIDA', 'LIQUIDACAO_PARCIAL_SALDO']
  return Object.entries(contagens).reduce((resumo, [status, count]) => {
    if (corretos.includes(status)) resumo.corretos += count
    else resumo.divergencias += count
    return resumo
  }, { corretos: 0, divergencias: 0 })
}

function formatList(values: string[]) {
  if (values.length <= 1) return values[0] || ''
  return `${values.slice(0, -1).join(', ')} e ${values.at(-1)}`
}

export function resumirBaseFinanceira(base: BaseFinanceiraDaData): ResumoBaseFinanceira {
  const basesDaConciliacao: BaseComLabel[] = [
    { label: 'Estoque D-2', base: base.estoqueD2 },
    { label: 'Estoque D-1', base: base.estoque },
    { label: 'Aquisições D-1', base: base.aquisicoes },
    { label: 'Liquidações D-1', base: base.liquidacoes },
  ]
  const ausentes = basesObrigatoriasConciliacao(base).filter(({ key }) => base[key].estado === 'INDISPONIVEL').map(item => item.label)
  if (ausentes.length > 0) {
    return {
      tone: 'warning',
      message: `Conciliação Financeira bloqueada: ${formatList(ausentes)} ${ausentes.length === 1 ? 'ainda não está disponível' : 'ainda não estão disponíveis'}.`,
    }
  }

  if (base.carteira.estado === 'INDISPONIVEL') {
    return {
      tone: 'warning',
      message: 'Bases de conciliação disponíveis. O PL de referência ainda não está disponível para Exposição em Trânsito e Gate de Risco.',
    }
  }

  const dispensadas = basesDaConciliacao.filter(item => item.base.estado === 'INDISPONIVEL' && baseMovimentoDispensada(base, item.base.tipo))
  if (diagnosticoCompativel(base) && dispensadas.length) {
    return { tone: 'success', message: `Conciliação integral disponível. ${formatList(dispensadas.map(item => item.label))} dispensadas pela comparação por título e saldo principal. Nenhuma base vazia foi criada.` }
  }

  const semMovimento = basesDaConciliacao.filter((item) => item.base.estado === 'SEM_MOVIMENTO').map((item) => item.label)
  if (semMovimento.length === basesDaConciliacao.length) {
    return { tone: 'default', message: 'A base foi publicada sem movimento para a data de referência.' }
  }
  if (semMovimento.length > 0) {
    return {
      tone: 'success',
      message: `Base financeira disponível. ${formatList(semMovimento)} ${semMovimento.length === 1 ? 'foi publicada' : 'foram publicadas'} sem movimento.`,
    }
  }

  return { tone: 'success', message: 'Base financeira disponível para a data operacional selecionada.' }
}
