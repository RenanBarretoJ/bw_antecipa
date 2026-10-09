import 'server-only'
import { requireRole, AuthorizationError } from '@/lib/auth/authorization'
import { requireSessaoMfaValida } from '@/lib/auth/mfa'
import { emailErrorMessage } from './presentation'

export async function requireEmailOperator() {
  const context = await requireRole(['gestor', 'super_admin'])
  await requireSessaoMfaValida(context)
  return context
}

const messages: Record<string, string> = {
  EMAIL_ACCESS_DENIED: 'Seu acesso ou a confirmação MFA não permite esta ação. Confirme o fundo e entre novamente se necessário.',
  EMAIL_CONFIG_CONFLICT: 'Esta configuração foi alterada por outra pessoa. Reabra a integração e confira a versão atual.',
  EMAIL_CREDENTIAL_INCOMPATIBLE: 'Escolha uma credencial ativa do mesmo fundo, ambiente e provedor.',
  EMAIL_CREDENTIAL_UNAVAILABLE: 'A credencial não está disponível. Peça ao administrador para conferir seu vínculo e status.',
  EMAIL_PAUSE_BEFORE_EDIT: 'Desative a integração antes de editar. O histórico será preservado.',
  EMAIL_PROCESSING: 'Há um processamento em andamento. Aguarde sua conclusão antes de editar.',
  EMAIL_HISTORY_IMMUTABLE: 'Esta integração já recebeu documentos. Preserve a caixa e o ambiente; a data inicial só pode avançar.',
  EMAIL_CEDENTE_DENIED: 'Um cedente selecionado não está ativo neste fundo. Confira a seleção.',
  EMAIL_CONFIGURATION_INCOMPLETE: 'Complete os dados da caixa e selecione uma credencial ativa antes de testar.',
  EMAIL_TEST_COOLDOWN: 'Aguarde um minuto entre os testes de conexão.',
  EMAIL_TEST_EXPIRED: 'A configuração mudou ou o teste expirou. Confira a integração e teste novamente.',
  EMAIL_ACTIVATION_INCOMPLETE: 'Confira os campos obrigatórios, a restrição de acesso à caixa e o teste de conexão antes de ativar.',
  EMAIL_INVALID_CONFIGURATION: 'Confira os campos indicados e tente salvar novamente.',
}
export function operatorError(error: unknown): string {
  if (error instanceof AuthorizationError) return error.message
  const code = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  return Object.hasOwn(messages, code) ? messages[code] : emailErrorMessage(code || 'UNKNOWN')
}
