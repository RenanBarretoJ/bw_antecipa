/** Operator wording only. Fiscal outcomes and health decisions remain in their certified services. */
export type OperatorTone = 'neutral' | 'success' | 'attention' | 'error'
export type OperatorFeedback = { label: string; description: string; tone: OperatorTone }

const attachmentStates: Record<string, OperatorFeedback> = {
  PENDING: { label: 'Aguardando', description: 'O documento aguarda processamento automático.', tone: 'neutral' },
  PROCESSING: { label: 'Processando', description: 'A importação está em andamento. Aguarde a conclusão.', tone: 'neutral' },
  IMPORTED: { label: 'Importado', description: 'Documento fiscal importado.', tone: 'success' },
  DUPLICATE: { label: 'Duplicado', description: 'Documento fiscal já existente. Nenhuma nova nota foi criada.', tone: 'neutral' },
  REQUIRES_REVIEW: { label: 'Em revisão', description: 'Vencimento não encontrado no documento. O responsável deve concluir a revisão.', tone: 'attention' },
  RETRY: { label: 'Nova tentativa agendada', description: 'A importação será tentada novamente no horário indicado.', tone: 'attention' },
  RETRYABLE_ERROR: { label: 'Nova tentativa agendada', description: 'A importação será tentada novamente no horário indicado.', tone: 'attention' },
  QUARANTINED: { label: 'Requer verificação', description: 'Confira o cedente e a autorização para receber seus documentos.', tone: 'attention' },
  REJECTED: { label: 'Não importado', description: 'Confira o arquivo e o motivo informado antes de enviar novamente.', tone: 'error' },
  REJECTED_INVALID: { label: 'Documento inválido', description: 'Envie um documento fiscal legível com a chave fiscal.', tone: 'error' },
  REJECTED_UNSUPPORTED: { label: 'Formato não aceito', description: 'Envie o documento fiscal em XML ou PDF.', tone: 'attention' },
  REJECTED_UNKNOWN_CEDENTE: { label: 'Cedente não identificado', description: 'Confira se o emitente do documento está cadastrado e ativo neste fundo.', tone: 'attention' },
  AMBIGUOUS: { label: 'Cedente ambíguo', description: 'Há mais de um vínculo elegível. Confira o cadastro antes de reenviar.', tone: 'attention' },
  FAILED: { label: 'Falha na importação', description: 'Confira o motivo e solicite ajuda ao administrador se a falha persistir.', tone: 'error' },
  CLEANUP_PENDING: { label: 'Finalizando limpeza', description: 'Aguarde a conclusão da limpeza automática antes de reenviar.', tone: 'attention' },
  IGNORED: { label: 'Desconsiderado', description: 'Este anexo não participa da importação fiscal.', tone: 'neutral' },
}

const rejectionReasons: Record<string, OperatorFeedback> = {
  UNKNOWN_CEDENTE: attachmentStates.REJECTED_UNKNOWN_CEDENTE,
  AMBIGUOUS: attachmentStates.AMBIGUOUS,
  ROUTING_DENIED: { label: 'Cedente não autorizado', description: 'Confira a lista de cedentes permitidos para esta integração.', tone: 'attention' },
  INVALID: attachmentStates.REJECTED_INVALID,
  UNSUPPORTED_FILE: attachmentStates.REJECTED_UNSUPPORTED,
  FILE_TOO_LARGE: { label: 'Arquivo muito grande', description: 'Envie um XML ou PDF de até 20 MB.', tone: 'attention' },
}

export function attachmentFeedback(status: string, errorCode: string | null): OperatorFeedback {
  // A historical error must not override a successful or currently processing result.
  if (['QUARANTINED', 'REJECTED', 'FAILED'].includes(status) && errorCode && Object.hasOwn(rejectionReasons, errorCode)) {
    return rejectionReasons[errorCode]
  }
  if (Object.hasOwn(attachmentStates, status)) return attachmentStates[status]
  return { label: 'Estado não reconhecido', description: 'Atualize a página. Se continuar, solicite ajuda ao administrador.', tone: 'attention' }
}

const knownErrors: Record<string, string> = {
  AUTHENTICATION: 'A credencial foi recusada. Peça ao administrador para conferir a autenticação da conta.',
  ACCESS_DENIED: 'A credencial não tem acesso a esta caixa. Confira as permissões da aplicação.',
  CONFIGURATION: 'A configuração está incompleta. Confira a conta e a credencial antes de testar novamente.',
  NOT_FOUND: 'A caixa ou pasta não foi encontrada. Confira os dados da conta.',
  THROTTLED: 'O provedor limitou as consultas. O sistema respeitará o prazo para uma nova tentativa.',
  PROVIDER_UNAVAILABLE: 'O provedor está temporariamente indisponível. Aguarde uma nova tentativa.',
  CURSOR_EXPIRED: 'A leitura precisa ser retomada. A recuperação automática preserva a data inicial configurada.',
  INVALID_RESPONSE: 'O provedor retornou uma resposta inesperada. Solicite ajuda se o erro persistir.',
  LEASE_LOST: 'Outra execução assumiu o processamento. Aguarde a atualização do resultado.',
}

export function emailErrorMessage(code: string | null): string {
  if (!code) return 'Nenhuma falha registrada.'
  return Object.hasOwn(knownErrors, code) ? knownErrors[code]
    : 'Não foi possível concluir esta ação. Confira a configuração e solicite ajuda se o erro persistir.'
}

export function safeEmailErrorCode(code: string | null): string {
  if (!code) return 'Sem erro'
  return Object.hasOwn(knownErrors, code) || Object.hasOwn(rejectionReasons, code) ? code : 'Não classificado'
}

export function emailDateLabel(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Ainda não registrado'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
  }).format(new Date(value))
}
