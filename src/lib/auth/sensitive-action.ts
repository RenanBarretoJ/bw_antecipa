import { randomBytes } from 'node:crypto'
import type { AuthContext } from '@/lib/auth/authorization'
import { AuthorizationError } from '@/lib/auth/authorization'
import {
  type AcaoSensivelTipo,
  hashSeguranca,
  registrarEventoSeguranca,
  requireSessaoMfaValida,
  sanitizarCodigoTotp,
  validarFormatoCodigoTotp,
} from '@/lib/auth/mfa'
import { registrarTentativaRateLimit, verificarRateLimit } from '@/lib/security/rate-limit'

type MfaFactor = { id?: string; status?: string; factor_type?: string }

/**
 * Confirma TOTP no Supabase Auth e cria/consome, na mesma chamada de aplicação,
 * uma autorização curta, de uso único e vinculada à sessão e à ação exatas.
 * O código TOTP e o nonce em texto puro nunca são persistidos nem auditados.
 */
export async function autorizarEConsumirAcaoSensivel(
  context: AuthContext,
  actionType: AcaoSensivelTipo,
  codigoInformado: string,
) {
  const estado = await requireSessaoMfaValida(context)
  const code = sanitizarCodigoTotp(codigoInformado)
  if (!validarFormatoCodigoTotp(code)) {
    throw new AuthorizationError('Informe o código TOTP de 6 dígitos para confirmar esta ação.', 'FORBIDDEN')
  }

  const identifier = `${context.user.id}:${estado.sessaoId || 'sem-sessao'}:${actionType}`
  const limited = await verificarRateLimit({ escopo: 'mfa_sensitive', identifier, limite: 5, janelaMs: 10 * 60 * 1000 })
  if (!limited.allowed) throw new AuthorizationError('Muitas tentativas de confirmação MFA. Aguarde e tente novamente.', 'FORBIDDEN')

  const mfa = context.supabase.auth.mfa
  const { data: factorsData, error: factorsError } = await mfa.listFactors()
  const factors = [...(factorsData?.totp || []), ...(factorsData?.all || [])] as MfaFactor[]
  const factor = factors.find((item) => item.id && item.status === 'verified' && (!item.factor_type || item.factor_type === 'totp'))
  if (factorsError || !factor?.id) {
    await registrarTentativaRateLimit({ escopo: 'mfa_sensitive', identifier, sucesso: false })
    throw new AuthorizationError('Fator TOTP verificado não encontrado.', 'FORBIDDEN')
  }

  const challenge = await mfa.challenge({ factorId: factor.id })
  const verified = challenge.data?.id
    ? await mfa.verify({ factorId: factor.id, challengeId: challenge.data.id, code })
    : { error: challenge.error || new Error('challenge_not_created') }

  if (verified.error) {
    await registrarTentativaRateLimit({ escopo: 'mfa_sensitive', identifier, sucesso: false })
    await registrarEventoSeguranca({
      tipo_evento: 'MFA_ACAO_SENSIVEL_FALHOU',
      usuario_id: context.user.id,
      ator_usuario_id: context.user.id,
      severidade: 'warning',
      dados: { action_type: actionType, session_id: estado.sessaoId },
    })
    throw new AuthorizationError('Código TOTP inválido.', 'FORBIDDEN')
  }

  const { data: aal } = await mfa.getAuthenticatorAssuranceLevel()
  if (aal?.currentLevel !== 'aal2') {
    await registrarTentativaRateLimit({ escopo: 'mfa_sensitive', identifier, sucesso: false })
    throw new AuthorizationError('O Supabase Auth não confirmou AAL2 para esta ação.', 'FORBIDDEN')
  }

  const nonce = randomBytes(32).toString('hex')
  const nonceHash = hashSeguranca(nonce)
  const { error: createError } = await context.supabase.rpc('criar_autorizacao_acao_sensivel', {
    p_action_type: actionType,
    p_nonce_hash: nonceHash,
  })
  if (createError) {
    console.error('[mfa/sensitive][create-authorization]', { actionType, sessionId: estado.sessaoId, code: createError.code })
    throw new Error('Não foi possível confirmar esta ação sensível.')
  }

  const { data: consumed, error: consumeError } = await context.supabase.rpc('consumir_autorizacao_acao_sensivel', {
    p_action_type: actionType,
    p_nonce_hash: nonceHash,
  })
  if (consumeError || consumed !== true) {
    await registrarEventoSeguranca({
      tipo_evento: 'AUTORIZACAO_SENSIVEL_REUTILIZACAO_BLOQUEADA',
      usuario_id: context.user.id,
      ator_usuario_id: context.user.id,
      severidade: 'critical',
      dados: { action_type: actionType, session_id: estado.sessaoId },
    })
    throw new AuthorizationError('A autorização desta ação expirou ou já foi utilizada.', 'FORBIDDEN')
  }

  await registrarTentativaRateLimit({ escopo: 'mfa_sensitive', identifier, sucesso: true })
  await registrarEventoSeguranca({
    tipo_evento: 'MFA_ACAO_SENSIVEL_VALIDADA',
    usuario_id: context.user.id,
    ator_usuario_id: context.user.id,
    dados: { action_type: actionType, session_id: estado.sessaoId },
  })
  await registrarEventoSeguranca({
    tipo_evento: 'AUTORIZACAO_SENSIVEL_CONSUMIDA',
    usuario_id: context.user.id,
    ator_usuario_id: context.user.id,
    dados: { action_type: actionType, session_id: estado.sessaoId },
  })

  return { sessionId: estado.sessaoId, actionType }
}
