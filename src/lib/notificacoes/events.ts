// The operational selector fences all in-flight notification requests before
// changing its cookie. No credentials, IDs or notification payloads in events.
export const NOTIFICACOES_CONTEXTO_INICIO = 'bw:notificacoes:contexto-inicio'
export const NOTIFICACOES_CONTEXTO_FIM = 'bw:notificacoes:contexto-fim'
export const NOTIFICACOES_ATUALIZAR = 'bw:notificacoes:atualizar'
export function iniciarTrocaContextoNotificacoes() { window.dispatchEvent(new Event(NOTIFICACOES_CONTEXTO_INICIO)) }
export function concluirTrocaContextoNotificacoes() { window.dispatchEvent(new Event(NOTIFICACOES_CONTEXTO_FIM)) }
