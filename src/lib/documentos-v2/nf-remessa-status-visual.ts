import type { StatusValidacaoRemessa } from '@/lib/logistica/nf-remessa-matching'

export type StatusVisualNfRemessa = 'nao_enviada' | 'pendente' | 'validada' | 'aguardando_analise' | 'em_revisao' | 'rejeitada'

/** Decisao documental da gestora sobre uma remessa cujo matching e VALIDADA (coluna `aprovacao_documental`). Null/undefined = nao aplicavel (matching diferente de VALIDADA, ou a politica nao exige validacao manual/hibrida para este requisito). */
export type AprovacaoDocumentalRemessa = 'aguardando_analise' | 'aprovado' | 'rejeitado' | null | undefined

/**
 * Ticket de consolidacao da UI (NF de Remessa dentro de Requisitos
 * Documentais), estendido pelo ticket de separacao matching/aprovacao
 * documental. Decide o rotulo visual do requisito nf_remessa a partir das
 * remessas reais da venda -- nunca do status generico
 * ('pendente'/'satisfeito') de documento_requisito_instancias, que nao
 * distingue opcional-sem-remessa de obrigatorio-sem-remessa (regra 4/5 do
 * ticket: opcional sem remessa e "Nao enviada", nunca "Pendente").
 *
 * Matching (`status_validacao`) e aprovacao documental (`aprovacao_
 * documental`) sao decisoes separadas: uma remessa so pode estar em
 * aprovacao quando o matching ja disse VALIDADA. Prioridade quando ha
 * multiplas remessas com estado misto (da mais alta para a mais baixa):
 *   1. VALIDADA + (aprovacao_documental nulo OU 'aprovado')      -> validada
 *   2. VALIDADA + aprovacao_documental='aguardando_analise'      -> aguardando_analise
 *   3. VALIDADA + aprovacao_documental='rejeitado'               -> rejeitada
 *   4. REVISAO_MANUAL (matching)                                 -> em_revisao
 *   5. REJEITADA (matching)                                      -> rejeitada
 *   6. nenhuma remessa relevante                                 -> obrigatorio ? pendente : nao_enviada
 */
export function resolverStatusVisualNfRemessa(input: {
  obrigatorio: boolean
  remessas: Array<{ status_validacao: StatusValidacaoRemessa; aprovacao_documental?: AprovacaoDocumentalRemessa }>
}): StatusVisualNfRemessa {
  const validadas = input.remessas.filter((remessa) => remessa.status_validacao === 'VALIDADA')
  if (validadas.some((remessa) => remessa.aprovacao_documental == null || remessa.aprovacao_documental === 'aprovado')) return 'validada'
  if (validadas.some((remessa) => remessa.aprovacao_documental === 'aguardando_analise')) return 'aguardando_analise'
  if (validadas.some((remessa) => remessa.aprovacao_documental === 'rejeitado')) return 'rejeitada'
  if (input.remessas.some((remessa) => remessa.status_validacao === 'REVISAO_MANUAL')) return 'em_revisao'
  if (input.remessas.some((remessa) => remessa.status_validacao === 'REJEITADA')) return 'rejeitada'
  return input.obrigatorio ? 'pendente' : 'nao_enviada'
}

export function satisfazRequisitoNfRemessa(status: StatusVisualNfRemessa): boolean {
  return status === 'validada'
}

/**
 * Remessa em destaque no cabecalho do requisito (ex.: alvo do botao "Ver"
 * rapido). Prioriza uma remessa VALIDADA cuja aprovacao documental esta
 * resolvida (nula -- politica automatica -- ou 'aprovado'); sem essa, cai
 * para a mais recente (assume `remessas` ordenado por created_at desc,
 * como retornado por `listarRemessasDaNota`).
 */
export function resolverRemessaDestacada<
  T extends { status_validacao: StatusValidacaoRemessa; aprovacao_documental?: AprovacaoDocumentalRemessa },
>(remessas: readonly T[]): T | null {
  const aprovada = remessas.find(
    (remessa) => remessa.status_validacao === 'VALIDADA' && (remessa.aprovacao_documental == null || remessa.aprovacao_documental === 'aprovado'),
  )
  return aprovada || remessas[0] || null
}

/**
 * Rotulo do botao de envio no cabecalho do requisito. "Enviar nova versão"
 * quando a remessa mais recente foi REJEITADA pelo matching tecnico (o
 * envio corrige/substitui o mesmo lastro); "Enviar outra NF de Remessa" nos
 * demais casos (uma remessa adicional/parcial). Rotulo puro -- nao cria
 * nenhum rastreamento novo de "mesma remessa vs remessa nova".
 */
export function resolverLabelEnvioNfRemessa(remessaMaisRecente: { status_validacao: StatusValidacaoRemessa } | null): string {
  return remessaMaisRecente?.status_validacao === 'REJEITADA' ? 'Enviar nova versão' : 'Enviar outra NF de Remessa'
}
