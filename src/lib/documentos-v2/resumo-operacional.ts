export type StatusLogisticoResumo =
  | 'nao_iniciado'
  | 'aguardando_desembolso'
  | 'em_transito'
  | 'aguardando_comprovante'
  | 'documento_enviado'
  | 'em_analise'
  | 'entrega_confirmada'
  | 'em_atraso'
  | 'cancelada'
  | 'devolvida'

export function calcularStatusLogisticoDocumental({
  entregaStatus,
  nfStatus,
  possuiRequisitosPosCessao,
  possuiDocumentoPosCessaoEnviado,
  posCessaoVencida,
}: {
  entregaStatus: string | null
  nfStatus: string | null
  possuiRequisitosPosCessao: boolean
  possuiDocumentoPosCessaoEnviado: boolean
  posCessaoVencida: boolean
}): StatusLogisticoResumo {
  if (!entregaStatus) {
    return nfStatus === 'em_antecipacao' || nfStatus === 'aprovada' ? 'aguardando_desembolso' : 'nao_iniciado'
  }
  if (entregaStatus === 'entregue') return 'entrega_confirmada'
  if (entregaStatus === 'cancelada') return 'cancelada'
  if (entregaStatus === 'devolvida') return 'devolvida'
  if (entregaStatus === 'entrega_com_pendencia' || posCessaoVencida) return 'em_atraso'
  if (entregaStatus === 'aguardando_validacao') return 'em_analise'
  if (possuiDocumentoPosCessaoEnviado) return 'documento_enviado'
  if (possuiRequisitosPosCessao) return 'aguardando_comprovante'
  return 'em_transito'
}
