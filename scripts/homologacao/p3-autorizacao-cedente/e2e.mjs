#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const EXPECTED_REF = 'fhgkmggthxikfpogrvaa'
const runId = randomBytes(5).toString('hex')
const password = `Qa@${randomBytes(18).toString('base64url')}9Z`
const roles = ['owner', 'admin', 'operacional', 'revogado', 'externo']
const emails = Object.fromEntries(roles.map((role) => [role, `qa-p3-${role}-${runId}@qa-bw.invalid`]))
const userIds = []
const cedenteIds = []
const results = []

loadEnv(resolve('.env.homolog'))
const apiUrl = required('NEXT_PUBLIC_SUPABASE_URL')
const apiRef = new URL(apiUrl).hostname.split('.')[0]
const productionRef = required('SUPABASE_PRODUCTION_PROJECT_REF')
const dbUrl = new URL(required('SUPABASE_DB_URL'))
dbUrl.password = required('SUPABASE_PASSWORD')
if (apiRef !== EXPECTED_REF || apiRef === productionRef || !`${dbUrl.hostname} ${decodeURIComponent(dbUrl.username)}`.includes(EXPECTED_REF)) {
  throw new Error('Destino de homologacao recusado.')
}

const adminClient = createClient(apiUrl, required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
})
const db = new pg.Client({ connectionString: dbUrl.toString(), ssl: { rejectUnauthorized: false }, application_name: 'bw_antecipa_p3_e2e' })

await db.connect()
try {
  const migration = await db.query("select 1 from supabase_migrations.schema_migrations where version = '20260826200000'")
  assert(migration.rowCount === 1, 'migration P3 registrada em homologacao')

  const users = {}
  for (const role of roles) users[role] = await createUser(role)
  const fundo = await db.query('select id from public.fundos where ativo is true order by created_at, id limit 1')
  assert(fundo.rowCount === 1, 'fundo ativo disponivel para o E2E')
  const fundoId = fundo.rows[0].id

  const cnpjA = cnpjDigits(`81${digits(runId).padEnd(10, '7')}`)
  const cnpjB = cnpjDigits(`82${digits(runId).padEnd(10, '8')}`)
  const cedenteA = randomUUID()
  const cedenteB = randomUUID()
  cedenteIds.push(cedenteA, cedenteB)
  await db.query(
    `insert into public.cedentes(id,user_id,cnpj,razao_social,status,permite_cadastro_filiais)
     values ($1,$2,$3,$4,'ativo',true),($5,$6,$7,$8,'ativo',true)`,
    [cedenteA, users.owner.id, cnpjA, `QA P3 A ${runId}`, cedenteB, users.externo.id, cnpjB, `QA P3 B ${runId}`],
  )
  const cedenteFundoId = randomUUID()
  await db.query(
    `insert into public.cedente_fundos(id,cedente_id,fundo_id,status)
     values ($1,$2,$3,'ativo')`,
    [cedenteFundoId, cedenteA, fundoId],
  )
  await db.query(
    `insert into public.cedente_acessos(user_id,cedente_id,perfil,status,ativo,aceito_em,revogado_em)
     values
       ($1,$5,'ADMIN','ATIVO',true,now(),null),
       ($2,$5,'ADMIN','ATIVO',true,now(),null),
       ($3,$5,'OPERACIONAL','ATIVO',true,now(),null),
       ($4,$5,'OPERACIONAL','REVOGADO',false,null,now()),
       ($6,$7,'ADMIN','ATIVO',true,now(),null)`,
    [users.owner.id, users.admin.id, users.operacional.id, users.revogado.id, cedenteA, users.externo.id, cedenteB],
  )
  const matrizExistente = await db.query(
    "select id from public.cedente_estabelecimentos where cedente_id = $1 and tipo = 'matriz'",
    [cedenteA],
  )
  const matrizId = matrizExistente.rows[0]?.id || randomUUID()
  if (matrizExistente.rowCount) {
    await db.query(
      "update public.cedente_estabelecimentos set status = 'aprovado', ativo = true, aprovado_em = now() where id = $1",
      [matrizId],
    )
  } else {
    await db.query(
      `insert into public.cedente_estabelecimentos(id,cedente_id,cnpj,razao_social,tipo,status,ativo,aprovado_em)
       values ($1,$2,$3,$4,'matriz','aprovado',true,now())`,
      [matrizId, cedenteA, cnpjA, `QA P3 MATRIZ ${runId}`],
    )
  }

  const clients = {}
  for (const role of roles) clients[role] = await signIn(role)

  await assertContext(clients.owner, cedenteA, 'ADMIN', 'owner legado backfillado opera pela associacao canonica')
  await assertContext(clients.admin, cedenteA, 'ADMIN', 'segundo ADMIN autorizado')
  await assertContext(clients.operacional, cedenteA, 'OPERACIONAL', 'OPERACIONAL autorizado')
  await assertContext(clients.externo, cedenteB, 'ADMIN', 'Cedente B isolado')

  const revokedId = await clients.revogado.rpc('get_user_cedente_id')
  const revokedProfile = await clients.revogado.rpc('get_user_cedente_perfil_canonico')
  assert(!revokedId.error && revokedId.data === null && !revokedProfile.error && revokedProfile.data === null, 'REVOGADO bloqueado sem fallback owner')

  const cross = await clients.operacional.from('cedentes').select('id').eq('id', cedenteB)
  assert(!cross.error && cross.data.length === 0, 'OPERACIONAL do Cedente A nao le Cedente B')

  const contaAdmin = await clients.admin.rpc('salvar_conta_estabelecimento_cedente', {
    p_estabelecimento_id: matrizId,
    p_banco: '001', p_agencia: '0001', p_conta: `P3-${runId}`, p_tipo_conta: 'corrente',
    p_principal: true, p_banco_codigo: '001', p_banco_ispb: '00000000', p_banco_nome: 'Banco QA',
  })
  assert(!contaAdmin.error && contaAdmin.data?.id, 'ADMIN altera conta bancaria')

  const contaOperacional = await clients.operacional.rpc('salvar_conta_estabelecimento_cedente', {
    p_estabelecimento_id: matrizId,
    p_banco: '001', p_agencia: '0002', p_conta: 'BLOQUEADA', p_tipo_conta: 'corrente',
    p_principal: false, p_banco_codigo: '001', p_banco_ispb: '00000000', p_banco_nome: 'Banco QA',
  })
  assert(contaOperacional.error?.code === 'P0001', 'OPERACIONAL bloqueado em conta bancaria via RPC direta')

  const nf = await clients.operacional.from('notas_fiscais').insert({
    cedente_id: cedenteA,
    cedente_fundo_id: cedenteFundoId,
    fundo_id: fundoId,
    numero_nf: `P3-${runId}`,
    data_emissao: '2026-08-26',
    data_vencimento: '2026-09-26',
    cnpj_emitente: cnpjA,
    razao_social_emitente: `QA P3 A ${runId}`,
    cnpj_destinatario: '11222333000181',
    razao_social_destinatario: 'QA DESTINATARIO',
    valor_bruto: 1000,
    status: 'rascunho',
  }).select('id').single()
  assert(!nf.error && nf.data?.id, `OPERACIONAL cria NF em rascunho${nf.error ? ` (${nf.error.code}: ${nf.error.message})` : ''}`)

  const revokedNf = await clients.revogado.from('notas_fiscais').select('id').eq('cedente_id', cedenteA)
  assert(!revokedNf.error && revokedNf.data.length === 0, 'REVOGADO nao consulta NFs do Cedente')

  const filialOp = await clients.operacional.rpc('cadastrar_filial_cedente', {
    p_cnpj: cnpjDigits(cnpjA.slice(0, 8) + '0002'),
    p_razao_social: 'QA FILIAL BLOQUEADA',
  })
  assert(filialOp.error?.code === 'P0001', 'OPERACIONAL bloqueado ao cadastrar filial via RPC direta')

  console.log(JSON.stringify({ projeto: apiRef, resultado: 'PASS', verificacoes: results.length, detalhes: results }, null, 2))
} finally {
  await cleanup().catch((error) => console.error(`Limpeza E2E P3 falhou: ${error.message}`))
  await db.end()
}

function assert(condition, label) {
  if (!condition) throw new Error(`E2E P3 falhou: ${label}`)
  results.push(label)
}

async function assertContext(client, cedenteId, perfil, label) {
  const [id, role] = await Promise.all([
    client.rpc('get_user_cedente_id'),
    client.rpc('get_user_cedente_perfil_canonico'),
  ])
  assert(!id.error && !role.error && id.data === cedenteId && role.data === perfil, label)
}

async function createUser(role) {
  const { data, error } = await adminClient.auth.admin.createUser({
    email: emails[role], password, email_confirm: true,
    user_metadata: { role: 'cedente', nome_completo: `QA P3 ${role.toUpperCase()}`, qa_p3: true },
  })
  if (error || !data.user) throw new Error(`Falha ao criar usuario ${role}: ${error?.message || 'retorno vazio'}`)
  userIds.push(data.user.id)
  return data.user
}

async function signIn(role) {
  const client = createClient(apiUrl, required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { error } = await client.auth.signInWithPassword({ email: emails[role], password })
  if (error) throw new Error(`Falha ao autenticar ${role}: ${error.message}`)
  return client
}

async function cleanup() {
  if (cedenteIds.length) {
    await db.query('delete from public.notas_fiscais where cedente_id = any($1::uuid[])', [cedenteIds])
    await db.query('delete from public.cedente_estabelecimento_contas_bancarias where estabelecimento_id in (select id from public.cedente_estabelecimentos where cedente_id = any($1::uuid[]))', [cedenteIds])
    await db.query('delete from public.cedente_estabelecimentos where cedente_id = any($1::uuid[])', [cedenteIds])
    await db.query('delete from public.cedente_acessos where cedente_id = any($1::uuid[])', [cedenteIds])
    await db.query('delete from public.cedente_fundos where cedente_id = any($1::uuid[])', [cedenteIds])
    await db.query('delete from public.cedentes where id = any($1::uuid[])', [cedenteIds])
  }
  if (userIds.length) {
    await db.query('delete from public.logs_auditoria where usuario_id = any($1::uuid[])', [userIds])
    for (const userId of [...new Set(userIds)].reverse()) await adminClient.auth.admin.deleteUser(userId).catch(() => undefined)
  }
  const residual = await db.query(`select
    (select count(*)::int from auth.users where id = any($1::uuid[])) auth_users,
    (select count(*)::int from public.cedentes where id = any($2::uuid[])) cedentes`, [userIds, cedenteIds])
  if (residual.rows[0].auth_users || residual.rows[0].cedentes) throw new Error(`Massa residual: ${JSON.stringify(residual.rows[0])}`)
  console.log('Limpeza E2E P3 confirmada: sem usuarios Auth ou Cedentes sinteticos residuais.')
}

function digits(value) { return String(value).replace(/\D/g, '') }
function cnpjDigits(seed) {
  const base = digits(seed).padEnd(12, '7').slice(0, 12)
  const digit = (value, weights) => {
    const sum = [...value].reduce((total, item, index) => total + Number(item) * weights[index], 0)
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
