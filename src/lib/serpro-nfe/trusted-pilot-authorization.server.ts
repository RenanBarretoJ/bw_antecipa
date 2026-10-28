import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import type { AuthContext } from '@/lib/auth/authorization'
import { requireAuthenticated } from '@/lib/auth/authorization'
import {
  registrarEventoSeguranca,
  requireSessaoMfaValida,
  sanitizarCodigoTotp,
  validarFormatoCodigoTotp,
} from '@/lib/auth/mfa'
import { listarPapeisAtivosUsuario } from '@/lib/auth/platform-access'
import { registrarTentativaRateLimit, verificarRateLimit } from '@/lib/security/rate-limit'
import { createAdminClient } from '@/lib/supabase/server'
import { validarChaveNfe55 } from './key'
import { runSerproNfePilotOnce } from './pilot-worker.server'

const PILOT_AUTHORIZATION_TTL_MS = 3 * 60 * 1000
const PILOT_MANUAL_ACTION = 'autorizar_consulta_serpro_piloto'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type TrustedPilotAuthorizationRequest = {
  fundoId: string
  notaFiscalId: string
  consultaId: string
  codigoTotp: string
}

export type TrustedPilotAuthorizationHandle = {
  consume(): Promise<
    | Awaited<ReturnType<typeof runSerproNfePilotOnce>>
    | { processed: 0; skipped: 'PILOT_HANDLE_ALREADY_USED' }
  >
  toJSON(): { status: 'SERVER_ONLY_HANDLE' }
}

type PilotTarget = {
  consultaId: string
  snapshotId: string
  fundoId: string
  notaFiscalId: string
  chaveAcesso: string
}

type PilotConsultationRow = {
  id: string
  snapshot_id: string
  fundo_id: string
  nota_fiscal_id: string
  status: string
  capability_state: string
  lease_token: string | null
  lease_ate: string | null
}

type PilotSnapshotRow = {
  id: string
  fundo_id: string
  nota_fiscal_id: string
  modelo: string
  chave_acesso: string
}

type MfaFactor = { id?: string; status?: string; factor_type?: string }

interface PilotAdminClient {
  rpc(name: 'nfe_fiscal_pilot_authorize', args: Record<string, unknown>): Promise<{
    data: unknown
    error: { message: string } | null
  }>
  from(name: 'logs_auditoria'): {
    insert(payload: Record<string, unknown>): Promise<{
      error: { message: string } | null
    }>
  }
}

export class TrustedPilotAuthorizationError extends Error {
  constructor(public readonly code:
    | 'INVALID_REQUEST'
    | 'ACCESS_DENIED'
    | 'MFA_DENIED'
    | 'TARGET_NOT_ELIGIBLE'
    | 'AUDIT_UNAVAILABLE'
    | 'AUTHORIZATION_REJECTED') {
    super(code)
    this.name = 'TrustedPilotAuthorizationError'
  }
}

function assertRequestedIds(input: TrustedPilotAuthorizationRequest) {
  if (![input.fundoId, input.notaFiscalId, input.consultaId].every(value => UUID_PATTERN.test(value))) {
    throw new TrustedPilotAuthorizationError('INVALID_REQUEST')
  }
}

function idempotencyFingerprint(context: AuthContext, input: TrustedPilotAuthorizationRequest) {
  return createHash('sha256')
    .update(`${context.user.id}:${input.fundoId}:${input.notaFiscalId}:${input.consultaId}`)
    .digest('hex')
}

async function requireFreshTotp(context: AuthContext, codigoInformado: string) {
  const estado = await requireSessaoMfaValida(context)
  if (!estado.sessaoId) throw new TrustedPilotAuthorizationError('MFA_DENIED')

  const code = sanitizarCodigoTotp(codigoInformado)
  if (!validarFormatoCodigoTotp(code)) {
    throw new TrustedPilotAuthorizationError('MFA_DENIED')
  }

  const identifier = `${PILOT_MANUAL_ACTION}:${context.user.id}:${estado.sessaoId}`
  const rateLimit = await verificarRateLimit({
    escopo: 'mfa_sensitive',
    identifier,
    limite: 5,
    janelaMs: 10 * 60 * 1000,
  })
  if (!rateLimit.allowed) throw new TrustedPilotAuthorizationError('MFA_DENIED')

  const mfa = context.supabase.auth.mfa
  const { data: factorsData, error: factorsError } = await mfa.listFactors()
  const factors = [...(factorsData?.totp || []), ...(factorsData?.all || [])] as MfaFactor[]
  const factor = factors.find(item => item.id
    && item.status === 'verified'
    && (!item.factor_type || item.factor_type === 'totp'))
  if (factorsError || !factor?.id) {
    await registrarTentativaRateLimit({ escopo: 'mfa_sensitive', identifier, sucesso: false })
    throw new TrustedPilotAuthorizationError('MFA_DENIED')
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
      origem: 'serpro_pilot_manual_local',
      dados: { action_type: PILOT_MANUAL_ACTION },
    })
    throw new TrustedPilotAuthorizationError('MFA_DENIED')
  }

  const { data: aal, error: aalError } = await mfa.getAuthenticatorAssuranceLevel()
  if (aalError || aal?.currentLevel !== 'aal2') {
    await registrarTentativaRateLimit({ escopo: 'mfa_sensitive', identifier, sucesso: false })
    throw new TrustedPilotAuthorizationError('MFA_DENIED')
  }

  await registrarTentativaRateLimit({ escopo: 'mfa_sensitive', identifier, sucesso: true })
  await registrarEventoSeguranca({
    tipo_evento: 'MFA_ACAO_SENSIVEL_VALIDADA',
    usuario_id: context.user.id,
    ator_usuario_id: context.user.id,
    origem: 'serpro_pilot_manual_local',
    dados: { action_type: PILOT_MANUAL_ACTION },
  })
  return estado.sessaoId
}

async function requireCanonicalRoleAndFund(context: AuthContext, fundoId: string) {
  const roles = await listarPapeisAtivosUsuario(
    context.supabase,
    context.user.id,
    context.profile.role,
  )
  if (roles.includes('super_admin')) return
  if (context.profile.role !== 'gestor') {
    throw new TrustedPilotAuthorizationError('ACCESS_DENIED')
  }

  const { data, error } = await context.supabase
    .from('usuario_fundos')
    .select('id')
    .eq('usuario_id', context.user.id)
    .eq('fundo_id', fundoId)
    .eq('status', 'ativo')
    .in('perfil_no_fundo', ['gestor', 'administrador', 'operador'])
    .limit(1)
    .maybeSingle()
  if (error || !data) throw new TrustedPilotAuthorizationError('ACCESS_DENIED')
}

async function loadCanonicalTarget(context: AuthContext, input: TrustedPilotAuthorizationRequest): Promise<PilotTarget> {
  const consultation = await context.supabase
    .from('nfe_fiscal_consultas')
    .select('id,snapshot_id,fundo_id,nota_fiscal_id,status,capability_state,lease_token,lease_ate')
    .eq('id', input.consultaId)
    .eq('fundo_id', input.fundoId)
    .eq('nota_fiscal_id', input.notaFiscalId)
    .maybeSingle()
  const row = consultation.data as PilotConsultationRow | null
  if (consultation.error || !row
    || row.status !== 'PENDENTE'
    || row.capability_state !== 'ENABLED'
    || row.lease_token !== null
    || row.lease_ate !== null) {
    throw new TrustedPilotAuthorizationError('TARGET_NOT_ELIGIBLE')
  }

  const snapshot = await context.supabase
    .from('nfe_fiscal_snapshots')
    .select('id,fundo_id,nota_fiscal_id,modelo,chave_acesso')
    .eq('id', row.snapshot_id)
    .eq('fundo_id', input.fundoId)
    .eq('nota_fiscal_id', input.notaFiscalId)
    .maybeSingle()
  const snapshotRow = snapshot.data as PilotSnapshotRow | null
  if (snapshot.error || !snapshotRow
    || snapshotRow.modelo !== '55'
    || !validarChaveNfe55(snapshotRow.chave_acesso)) {
    throw new TrustedPilotAuthorizationError('TARGET_NOT_ELIGIBLE')
  }

  return {
    consultaId: row.id,
    snapshotId: snapshotRow.id,
    fundoId: row.fundo_id,
    notaFiscalId: row.nota_fiscal_id,
    chaveAcesso: snapshotRow.chave_acesso,
  }
}

async function writeAudit(input: {
  context: AuthContext
  target: TrustedPilotAuthorizationRequest
  fingerprint: string
  outcome: 'REQUESTED' | 'CREATED' | 'REJECTED'
  reason?: 'DB_GATE_REJECTED'
}) {
  const admin = createAdminClient() as unknown as PilotAdminClient
  const { error } = await admin.from('logs_auditoria').insert({
    usuario_id: input.context.user.id,
    ator_tipo: 'usuario',
    origem: 'serpro_pilot_manual_local',
    ator_identificador: input.context.user.id,
    tipo_evento: `SERPRO_PILOT_AUTHORIZATION_${input.outcome}`,
    entidade_tipo: 'nfe_fiscal_consultas',
    entidade_id: input.target.consultaId,
    dados_antes: null,
    dados_depois: {
      fundo_id: input.target.fundoId,
      nota_fiscal_id: input.target.notaFiscalId,
      idempotency_fingerprint: input.fingerprint,
      custeio: 'SIMULADO_LOCAL',
      consulta_paga: true,
      resultado: input.outcome,
      motivo: input.reason || null,
    },
  })
  if (error) throw new TrustedPilotAuthorizationError('AUDIT_UNAVAILABLE')
}

function createServerOnlyHandle(workerInput: Parameters<typeof runSerproNfePilotOnce>[0]): TrustedPilotAuthorizationHandle {
  let consumed = false
  return Object.freeze({
    async consume() {
      if (consumed) return { processed: 0, skipped: 'PILOT_HANDLE_ALREADY_USED' as const }
      consumed = true
      return runSerproNfePilotOnce(workerInput)
    },
    toJSON() {
      return { status: 'SERVER_ONLY_HANDLE' as const }
    },
  })
}

/**
 * Facade interno e nao roteado. O navegador pode solicitar apenas os tres IDs
 * do alvo e informar o TOTP fresco. Identidade, sessao, papel, chave fiscal,
 * nonce, capacidade e orcamento sao derivados ou revalidados no servidor.
 */
export async function authorizeSerproNfePilotManual(
  input: TrustedPilotAuthorizationRequest,
): Promise<TrustedPilotAuthorizationHandle> {
  const context = await requireAuthenticated()
  assertRequestedIds(input)
  await requireCanonicalRoleAndFund(context, input.fundoId)
  const sessionId = await requireFreshTotp(context, input.codigoTotp)
  const target = await loadCanonicalTarget(context, input)
  const fingerprint = idempotencyFingerprint(context, input)

  await writeAudit({ context, target: input, fingerprint, outcome: 'REQUESTED' })

  const nonceHash = createHash('sha256').update(randomBytes(32)).digest('hex')
  const expiresAt = new Date(Date.now() + PILOT_AUTHORIZATION_TTL_MS).toISOString()
  const admin = createAdminClient() as unknown as PilotAdminClient
  const authorization = await admin.rpc('nfe_fiscal_pilot_authorize', {
    p_consulta_id: target.consultaId,
    p_fundo_id: target.fundoId,
    p_nota_fiscal_id: target.notaFiscalId,
    p_chave_acesso: target.chaveAcesso,
    p_nonce_hash: nonceHash,
    p_operador_id: context.user.id,
    p_operador_session_id: sessionId,
    p_expira_em: expiresAt,
  })
  const authorizationId = typeof authorization.data === 'string' ? authorization.data : null
  if (authorization.error || !authorizationId) {
    await writeAudit({
      context,
      target: input,
      fingerprint,
      outcome: 'REJECTED',
      reason: 'DB_GATE_REJECTED',
    })
    throw new TrustedPilotAuthorizationError('AUTHORIZATION_REJECTED')
  }

  await writeAudit({ context, target: input, fingerprint, outcome: 'CREATED' })
  return createServerOnlyHandle({
    authorizationId,
    consultaId: target.consultaId,
    fundoId: target.fundoId,
    notaFiscalId: target.notaFiscalId,
    chaveAcesso: target.chaveAcesso,
    nonceHash,
    operadorId: context.user.id,
  })
}
