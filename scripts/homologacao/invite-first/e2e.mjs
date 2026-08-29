#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const EXPECTED_REF = 'fhgkmggthxikfpogrvaa'
const runId = randomBytes(5).toString('hex')
const emails = {
  gestor: `qa-p2-gestor-${runId}@qa-bw.invalid`,
  cedente: `qa-p2-cedente-${runId}@qa-bw.invalid`,
  expirado: `qa-p2-expirado-${runId}@qa-bw.invalid`,
  semOrganizacao: `qa-p2-sem-org-${runId}@qa-bw.invalid`,
}
const password = `Qa@${randomBytes(18).toString('base64url')}9Z`
const authUserIds = []
const inviteIds = []
let gestorId = null
let cedenteId = null
let fundoId = null

loadEnv(resolve('.env.homolog'))
const apiUrl = required('NEXT_PUBLIC_SUPABASE_URL')
const apiRef = new URL(apiUrl).hostname.split('.')[0]
const productionRef = required('SUPABASE_PRODUCTION_PROJECT_REF')
const dbUrl = new URL(required('SUPABASE_DB_URL'))
dbUrl.password = required('SUPABASE_PASSWORD')
if (apiRef !== EXPECTED_REF || apiRef === productionRef || !`${dbUrl.hostname} ${decodeURIComponent(dbUrl.username)}`.includes(EXPECTED_REF)) {
  throw new Error('Destino de homologacao recusado.')
}

const admin = createClient(apiUrl, required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
})
const db = new pg.Client({ connectionString: dbUrl.toString(), ssl: { rejectUnauthorized: false }, application_name: 'bw_antecipa_p2_invite_first_e2e' })

const results = []
await db.connect()
try {
  const migration = await db.query("select 1 from supabase_migrations.schema_migrations where version = '20260826190000'")
  assert(migration.rowCount === 1, 'migration P2 aplicada')

  const funds = await db.query('select id from public.fundos where ativo is true order by created_at, id limit 2')
  assert(funds.rowCount >= 1, 'fundo ativo disponivel')
  fundoId = funds.rows[0].id

  const gestor = await createAuthUser(emails.gestor, 'gestor')
  gestorId = gestor.id
  await db.query(
    "insert into public.usuario_fundos(usuario_id, fundo_id, perfil_no_fundo, status, principal) values ($1, $2, 'administrador', 'ativo', true)",
    [gestorId, fundoId],
  )
  const gestorClient = await signIn(emails.gestor)

  const cnpj = cnpjDigits(`91${runId.replace(/[^0-9]/g, '').padEnd(10, '7')}`)
  const appToken = randomBytes(32).toString('hex')
  const appTokenHash = sha256(appToken)
  const correlationId = randomUUID()
  const createResult = await gestorClient.rpc('criar_convite_novo_cedente', {
    p_fundo_id: fundoId,
    p_cnpj: cnpj,
    p_email: emails.cedente,
    p_token_hash: appTokenHash,
    p_correlation_id: correlationId,
  })
  assert(!createResult.error && createResult.data?.convite_id, 'convite criado por Gestor autorizado')
  inviteIds.push(createResult.data.convite_id)

  const duplicatePending = await gestorClient.rpc('criar_convite_novo_cedente', {
    p_fundo_id: fundoId,
    p_cnpj: cnpj,
    p_email: emails.cedente,
    p_token_hash: sha256(randomBytes(32).toString('hex')),
    p_correlation_id: randomUUID(),
  })
  assert(duplicatePending.error?.code === '23505', 'convite pendente equivalente bloqueado')

  const generated = await admin.auth.admin.generateLink({
    type: 'invite', email: emails.cedente,
    options: { data: { role: 'cedente', nome_completo: 'QA P2 CEDENTE', origem: 'qa_p2' } },
  })
  assert(!generated.error && generated.data.user && generated.data.properties?.hashed_token, 'link Auth invite gerado')
  authUserIds.push(generated.data.user.id)

  const invitedClient = createClient(apiUrl, required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const verified = await invitedClient.auth.verifyOtp({ token_hash: generated.data.properties.hashed_token, type: 'invite' })
  assert(!verified.error && verified.data.user?.email === emails.cedente, 'OTP invite verificado e e-mail autenticado')

  const accepted = await invitedClient.rpc('aceitar_convite_novo_cedente', {
    p_token_hash: appTokenHash,
    p_correlation_id: randomUUID(),
  })
  assert(!accepted.error && accepted.data?.ok === true, 'convite aceito')
  cedenteId = accepted.data.cedente_id

  const createdCounts = await db.query(`select
    (select count(*)::int from public.cedentes where id = $1) cedentes,
    (select count(*)::int from public.cedente_estabelecimentos where cedente_id = $1 and tipo = 'matriz') matrizes,
    (select count(*)::int from public.cedente_fundos where cedente_id = $1 and fundo_id = $2 and status = 'ativo') vinculos,
    (select count(*)::int from public.cedente_acessos where cedente_id = $1 and user_id = $3 and perfil = 'ADMIN' and status = 'ATIVO') admins`, [cedenteId, fundoId, generated.data.user.id])
  assert(JSON.stringify(createdCounts.rows[0]) === JSON.stringify({ cedentes: 1, matrizes: 1, vinculos: 1, admins: 1 }), 'criacao atomica 1:1:1:1')

  const replay = await invitedClient.rpc('aceitar_convite_novo_cedente', { p_token_hash: appTokenHash, p_correlation_id: randomUUID() })
  assert(!replay.error && replay.data?.codigo === 'CONVITE_JA_UTILIZADO', 'replay bloqueado')

  const duplicateCnpj = await gestorClient.rpc('criar_convite_novo_cedente', {
    p_fundo_id: fundoId, p_cnpj: cnpj, p_email: `outro-${runId}@qa-bw.invalid`,
    p_token_hash: sha256(randomBytes(32).toString('hex')), p_correlation_id: randomUUID(),
  })
  assert(duplicateCnpj.error?.code === '23505', 'CNPJ cadastrado bloqueado')

  const unauthorizedFund = await gestorClient.rpc('criar_convite_novo_cedente', {
    p_fundo_id: funds.rows[1]?.id || randomUUID(), p_cnpj: cnpjDigits(`92${runId.replace(/[^0-9]/g, '').padEnd(10, '8')}`),
    p_email: `nao-autorizado-${runId}@qa-bw.invalid`, p_token_hash: sha256(randomBytes(32).toString('hex')),
    p_correlation_id: randomUUID(),
  })
  assert(unauthorizedFund.error?.code === '42501', 'fundo nao autorizado bloqueado')

  const onboarding = await invitedClient.rpc('concluir_onboarding_cedente', {
    p_cadastro: {
      cnpj,
      razao_social: `QA P2 CEDENTE ${runId}`,
      nome_fantasia: 'QA P2',
      cep: '01310100', logradouro: 'Avenida Paulista', numero: '1000', complemento: '',
      bairro: 'Bela Vista', cidade: 'Sao Paulo', estado: 'SP', telefone_comercial: '11999999999',
      email_comercial: emails.cedente, cnae: 'Teste de homologacao', banco: '001 - Banco do Brasil',
      agencia: '0001', conta: '12345-6', tipo_conta: 'corrente', banco_codigo: '001', banco_ispb: '00000000', banco_nome: 'Banco do Brasil',
      representantes: [{ nome: 'Responsavel QA P2', cpf: '37834157809', rg: '123456789', cargo: 'Administrador', email: emails.cedente, telefone: '11999999999' }],
    },
  })
  assert(!onboarding.error && onboarding.data?.criado === true, 'onboarding atualiza Cedente existente')
  const sameCedente = await db.query('select count(*)::int total, onboarding_concluido_em is not null concluido from public.cedentes where id = $1 group by onboarding_concluido_em', [cedenteId])
  assert(sameCedente.rows[0]?.total === 1 && sameCedente.rows[0]?.concluido === true, 'onboarding nao cria segundo Cedente')

  const approval = await gestorClient.rpc('aprovar_cadastro_cedente_gestor', { p_cedente_id: cedenteId })
  assert(!approval.error && approval.data?.[0]?.status === 'ativo', 'Gestor aprova Cedente no fundo correto')

  const queueVisibility = await db.query("select count(*)::int total from public.cedente_fundos cf join public.cedentes c on c.id = cf.cedente_id where cf.fundo_id = $1 and cf.cedente_id = $2 and cf.status = 'ativo' and c.status = 'ativo'", [fundoId, cedenteId])
  assert(queueVisibility.rows[0].total === 1, 'Cedente visivel no contexto do fundo sem vinculo manual')

  const expiredUser = await createAuthUser(emails.expirado, 'cedente')
  const expiredClient = await signIn(emails.expirado)
  const expiredCnpj = cnpjDigits(`93${runId.replace(/[^0-9]/g, '').padEnd(10, '9')}`)
  const expiredTokenHash = sha256(randomBytes(32).toString('hex'))
  const expiredInvite = await gestorClient.rpc('criar_convite_novo_cedente', {
    p_fundo_id: fundoId, p_cnpj: expiredCnpj, p_email: emails.expirado,
    p_token_hash: expiredTokenHash, p_correlation_id: randomUUID(),
  })
  assert(!expiredInvite.error && expiredInvite.data?.convite_id, 'convite para teste de expiracao criado')
  inviteIds.push(expiredInvite.data.convite_id)
  await db.query("update public.cedente_usuario_convites set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' where id = $1", [expiredInvite.data.convite_id])
  const expiredAcceptance = await expiredClient.rpc('aceitar_convite_novo_cedente', { p_token_hash: expiredTokenHash, p_correlation_id: randomUUID() })
  assert(!expiredAcceptance.error && expiredAcceptance.data?.codigo === 'CONVITE_EXPIRADO', 'token expirado bloqueado e auditado')
  const expiredOrphan = await db.query('select count(*)::int total from public.cedentes where user_id = $1', [expiredUser.id])
  assert(expiredOrphan.rows[0].total === 0, 'falha de aceite nao deixa Cedente orfao')

  const noOrgUser = await createAuthUser(emails.semOrganizacao, 'cedente')
  const noOrg = await db.query('select count(*)::int total from public.cedentes where user_id = $1', [noOrgUser.id])
  assert(noOrg.rows[0].total === 0, 'conta sem convite nao cria organizacao Cedente')

  const noOrgClient = await signIn(emails.semOrganizacao)
  const mismatchTokenHash = sha256(randomBytes(32).toString('hex'))
  const mismatchInvite = await gestorClient.rpc('criar_convite_novo_cedente', {
    p_fundo_id: fundoId,
    p_cnpj: cnpjDigits(`94${runId.replace(/[^0-9]/g, '').padEnd(10, '6')}`),
    p_email: `destinatario-${runId}@qa-bw.invalid`,
    p_token_hash: mismatchTokenHash,
    p_correlation_id: randomUUID(),
  })
  assert(!mismatchInvite.error && mismatchInvite.data?.convite_id, 'convite para teste de e-mail criado')
  inviteIds.push(mismatchInvite.data.convite_id)
  const mismatchAcceptance = await noOrgClient.rpc('aceitar_convite_novo_cedente', {
    p_token_hash: mismatchTokenHash,
    p_correlation_id: randomUUID(),
  })
  assert(!mismatchAcceptance.error && mismatchAcceptance.data?.codigo === 'CONVITE_EMAIL_DIVERGENTE', 'e-mail autenticado divergente bloqueado')
  const cancelled = await gestorClient.rpc('cancelar_convite_novo_cedente', {
    p_convite_id: mismatchInvite.data.convite_id,
    p_motivo: 'qa_email_divergente',
    p_correlation_id: randomUUID(),
  })
  assert(!cancelled.error && cancelled.data?.cancelado === true, 'convite cancelado pelo Gestor autorizado')

  const auditEntityIds = [...inviteIds, cedenteId]
  const audit = await db.query("select tipo_evento from public.logs_auditoria where entidade_id = any($1::uuid[]) or dados_depois->>'cedente_id' = $2::text", [auditEntityIds, cedenteId])
  const events = new Set(audit.rows.map((row) => row.tipo_evento))
  for (const event of ['CONVITE_NOVO_CEDENTE_CRIADO', 'CONVITE_NOVO_CEDENTE_ACEITO', 'CEDENTE_CRIADO_POR_CONVITE', 'CEDENTE_PRIMEIRO_FUNDO_VINCULADO', 'CONVITE_NOVO_CEDENTE_EXPIRADO', 'CONVITE_NOVO_CEDENTE_CANCELADO']) {
    assert(events.has(event), `auditoria ${event}`)
  }

  console.log(JSON.stringify({ projeto: apiRef, resultado: 'PASS', verificacoes: results.length, detalhes: results }, null, 2))
} finally {
  await cleanup().catch((error) => console.error(`Limpeza E2E falhou: ${error.message}`))
  await db.end()
}

function assert(condition, label) {
  if (!condition) throw new Error(`E2E P2 falhou: ${label}`)
  results.push(label)
}

async function createAuthUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { role, nome_completo: `QA P2 ${role.toUpperCase()}`, qa_p2_invite_first: true },
  })
  if (error || !data.user) throw new Error(`Falha ao criar usuario Auth sintetico: ${error?.message || 'retorno vazio'}`)
  authUserIds.push(data.user.id)
  return data.user
}

async function signIn(email) {
  const client = createClient(apiUrl, required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Falha ao autenticar usuario sintetico: ${error.message}`)
  return client
}

async function cleanup() {
  if (cedenteId) {
    await db.query('delete from public.contas_escrow where cedente_id = $1', [cedenteId])
    await db.query('delete from public.representantes where cedente_id = $1', [cedenteId])
    await db.query('delete from public.cedente_estabelecimento_contas_bancarias where estabelecimento_id in (select id from public.cedente_estabelecimentos where cedente_id = $1)', [cedenteId])
    await db.query('delete from public.cedente_acessos where cedente_id = $1', [cedenteId])
    await db.query('delete from public.cedente_fundos where cedente_id = $1', [cedenteId])
    await db.query('delete from public.cedente_estabelecimentos where cedente_id = $1', [cedenteId])
  }
  if (inviteIds.length) await db.query('delete from public.cedente_usuario_convites where id = any($1::uuid[])', [inviteIds])
  if (cedenteId) await db.query('delete from public.cedentes where id = $1', [cedenteId])
  if (authUserIds.length) {
    await db.query('delete from public.logs_auditoria where usuario_id = any($1::uuid[]) or entidade_id = any($1::uuid[])', [authUserIds])
    await db.query('delete from public.usuario_fundos where usuario_id = any($1::uuid[])', [authUserIds])
  }
  for (const userId of [...new Set(authUserIds)].reverse()) await admin.auth.admin.deleteUser(userId).catch(() => undefined)
  const residual = await db.query(`select
    (select count(*)::int from auth.users where id = any($1::uuid[])) auth_users,
    (select count(*)::int from public.cedente_usuario_convites where id = any($2::uuid[])) convites,
    (select count(*)::int from public.cedentes where id = $3) cedentes`, [authUserIds, inviteIds, cedenteId])
  if (residual.rows[0].auth_users || residual.rows[0].convites || residual.rows[0].cedentes) {
    throw new Error(`Massa sintetica residual detectada: ${JSON.stringify(residual.rows[0])}`)
  }
  console.log('Limpeza E2E P2 confirmada: 0 usuarios Auth, 0 convites e 0 Cedentes sinteticos residuais.')
}

function sha256(value) { return createHash('sha256').update(value).digest('hex') }
function cnpjDigits(seed) {
  const base = String(seed).replace(/\D/g, '').padEnd(12, '7').slice(0, 12)
  const digit = (digits, weights) => {
    const sum = [...digits].reduce((total, value, index) => total + Number(value) * weights[index], 0)
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }
  const first = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const second = digit(`${base}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${base}${first}${second}`
}
function required(key) {
  const value = process.env[key]
  if (!value) throw new Error(`${key} ausente em .env.homolog.`)
  return value
}
function loadEnv(path) {
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}
