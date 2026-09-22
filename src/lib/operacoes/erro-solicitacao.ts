export const NF_ALREADY_LINKED_TO_ACTIVE_OPERATION = 'NF_ALREADY_LINKED_TO_ACTIVE_OPERATION'
export const NF_ALREADY_LINKED_TO_ACTIVE_OPERATION_SQLSTATE = 'P1401'

type ErroRpcSolicitacaoOperacao = {
  code?: string | null
  message: string
}

export function mensagemErroSolicitacaoOperacao(error: ErroRpcSolicitacaoOperacao): string {
  if (
    error.code === NF_ALREADY_LINKED_TO_ACTIVE_OPERATION_SQLSTATE
    || error.message === NF_ALREADY_LINKED_TO_ACTIVE_OPERATION
  ) {
    return 'Uma ou mais NFs já estão vinculadas a uma operação ativa.'
  }

  return `Erro ao criar operacao: ${error.message}`
}
