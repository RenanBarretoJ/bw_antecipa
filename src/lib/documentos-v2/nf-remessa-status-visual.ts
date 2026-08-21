import type { StatusValidacaoRemessa } from '@/lib/logistica/nf-remessa-matching'

export type StatusVisualNfRemessa = 'nao_enviada' | 'pendente' | 'validada' | 'em_revisao' | 'rejeitada'

/**
 * Ticket de consolidacao da UI (NF de Remessa dentro de Requisitos
 * Documentais). Decide o rotulo visual do requisito nf_remessa a partir
 * das remessas reais da venda -- nunca do status generico
 * ('pendente'/'satisfeito') de documento_requisito_instancias, que nao
 * distingue opcional-sem-remessa de obrigatorio-sem-remessa (regra 4/5 do
 * ticket: opcional sem remessa e "Nao enviada", nunca "Pendente").
 *
 * Prioridade quando ha multiplas remessas com status misto: VALIDADA >
 * REVISAO_MANUAL > REJEITADA > (obrigatorio ? pendente : nao_enviada).
 */
export function resolverStatusVisualNfRemessa(input: {
  obrigatorio: boolean
  remessas: Array<{ status_validacao: StatusValidacaoRemessa }>
}): StatusVisualNfRemessa {
  if (input.remessas.some((remessa) => remessa.status_validacao === 'VALIDADA')) return 'validada'
  if (input.remessas.some((remessa) => remessa.status_validacao === 'REVISAO_MANUAL')) return 'em_revisao'
  if (input.remessas.some((remessa) => remessa.status_validacao === 'REJEITADA')) return 'rejeitada'
  return input.obrigatorio ? 'pendente' : 'nao_enviada'
}

export function satisfazRequisitoNfRemessa(status: StatusVisualNfRemessa): boolean {
  return status === 'validada'
}
