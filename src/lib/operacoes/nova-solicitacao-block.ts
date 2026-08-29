export type ErroConfiguracaoNovaSolicitacao = {
  code?: string
  message?: string
}

const CODIGOS_BLOQUEIO_CONFIGURACAO = new Set([
  'POLITICA_CONTEXT_NOT_CONFIGURED',
  'VINCULO_NOT_FOUND',
  'FUNDO_NOT_FOUND',
  'FUNDO_INATIVO',
])

export function mensagemBloqueioNovaSolicitacao(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as ErroConfiguracaoNovaSolicitacao
  if (!candidate.code || !CODIGOS_BLOQUEIO_CONFIGURACAO.has(candidate.code)) return null
  return candidate.message?.trim() || 'A configuracao operacional deste fundo ainda nao permite novas solicitacoes.'
}

