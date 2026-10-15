import type { OperacaoStatus } from '@/lib/types/domain'

export const STATUS_OPERACAO_ACEITE_SACADO = ['solicitada', 'em_analise'] as const satisfies readonly OperacaoStatus[]
export const STATUS_ACEITE_SACADO_COM_PENDENCIAS = ['pendente', 'contestado'] as const
export const LIMITE_LOTE_ACEITE_SACADO = 500

export function operacaoPermiteDecisaoSacado(operacao: {
  status: string | null
  aceite_sacado_exigido: boolean | null
  aceite_sacado_status: string | null
}): boolean {
  // Uma contestação mantém o bloqueio do Gestor, sem decidir as outras NFs.
  return operacao.aceite_sacado_exigido === true
    && STATUS_OPERACAO_ACEITE_SACADO.some((status) => status === operacao.status)
    && STATUS_ACEITE_SACADO_COM_PENDENCIAS.some((status) => status === operacao.aceite_sacado_status)
}
