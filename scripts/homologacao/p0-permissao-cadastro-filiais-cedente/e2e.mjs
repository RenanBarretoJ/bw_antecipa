#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const EXPECTED_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const checks = []

loadEnv(resolve('.env.homolog'))
const apiRef = new URL(required('NEXT_PUBLIC_SUPABASE_URL')).hostname.split('.')[0]
const productionRef = required('SUPABASE_PRODUCTION_PROJECT_REF')
const databaseUrl = new URL(required('SUPABASE_DB_URL'))
databaseUrl.password = required('SUPABASE_PASSWORD')

if (apiRef !== EXPECTED_PROJECT_REF) throw new Error(`Projeto de homologacao inesperado: ${apiRef}`)
if (apiRef === productionRef) throw new Error('Projeto de producao bloqueado.')

const db = new pg.Client({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false } })
await db.connect()

try {
  await db.query('BEGIN')

  const actorCedente = randomUUID()
  const actorGestor = randomUUID()
  const actorGestorOutroFundo = randomUUID()
  const actorSuperAdmin = randomUUID()
  const fundo = randomUUID()
  const fundoOutro = randomUUID()
  const cnpjMatriz = makeCnpj('910000030001')
  const cnpjFilial1 = makeCnpj('910000030002')
  const cnpjFilial2 = makeCnpj('910000030003')

  await createAuthUser(actorCedente, 'cedente')
  await createAuthUser(actorGestor, 'gestor')
  await createAuthUser(actorGestorOutroFundo, 'gestor')
  await createAuthUser(actorSuperAdmin, 'cedente')
  await db.query(`update public.profiles set role = 'super_admin' where id = $1`, [actorSuperAdmin])

  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Permissao Filiais',$2,'QA Admin',$3,'QA Gestora',$4,true,$5),
           ($6,'QA Permissao Filiais Outro',$7,'QA Admin B',$8,'QA Gestora B',$9,true,$5)`, [
    fundo, makeCnpj('920000030001'), makeCnpj('920000030002'), makeCnpj('920000030003'), actorGestor,
    fundoOutro, makeCnpj('920000040001'), makeCnpj('920000040002'), makeCnpj('920000040003'),
  ])

  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente Permissao Filiais','ativo') returning id, permite_cadastro_filiais`, [actorCedente, cnpjMatriz])).rows[0]
  await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo')`, [cedente.id, fundo])
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestor, fundo])
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestorOutroFundo, fundoOutro])

  ok('Cedente novo comeca com permite_cadastro_filiais=false', cedente.permite_cadastro_filiais === false)

  // flag false + zero Filiais -> RPC de nova Filial = DENY
  await asActor(actorCedente)
  await expectError('Flag false (zero Filiais) bloqueia cadastrar_filial_cedente', async () => {
    await db.query(`select * from public.cadastrar_filial_cedente($1,$2,$3)`, [cnpjFilial1, 'QA Filial 1', null])
  }, /nao esta habilitado para este Cedente/)

  // seguranca: outro fundo / super admin puro / anon nao alteram a flag
  await expectError('Gestor de outro fundo nao habilita a flag (cross-fundo)', async () => {
    await asActor(actorGestorOutroFundo)
    await db.query(`select * from public.alternar_cadastro_filiais_cedente_gestor($1, true)`, [cedente.id])
  }, /sem vinculo ativo com o fundo/)

  await expectError('Super Admin puro nao habilita a flag (sem operacao implicita)', async () => {
    await asActor(actorSuperAdmin)
    await db.query(`select * from public.alternar_cadastro_filiais_cedente_gestor($1, true)`, [cedente.id])
  }, /sem vinculo ativo com o fundo/)

  await expectError('Anon nao habilita a flag', async () => {
    await db.query('RESET ROLE')
    await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ role: 'anon' })])
    await db.query('SET LOCAL ROLE anon')
    await db.query(`select * from public.alternar_cadastro_filiais_cedente_gestor($1, true)`, [cedente.id])
  }, /permission denied/i)

  await expectError('Cedente nao habilita a propria flag', async () => {
    await asActor(actorCedente)
    await db.query(`select * from public.alternar_cadastro_filiais_cedente_gestor($1, true)`, [cedente.id])
  }, /sem vinculo ativo com o fundo/)

  // Gestor autorizado habilita = ALLOW
  await asActor(actorGestor)
  const habilitado = (await db.query(`select * from public.alternar_cadastro_filiais_cedente_gestor($1, true)`, [cedente.id])).rows[0]
  ok('Gestor autorizado habilita a permissao = ALLOW', habilitado.permite_cadastro_filiais === true)

  // Cedente passa a poder cadastrar Filial
  await asActor(actorCedente)
  const filial1 = (await db.query(`select * from public.cadastrar_filial_cedente($1,$2,$3)`, [cnpjFilial1, 'QA Filial 1', null])).rows[0]
  ok('Cedente cadastra Filial apos habilitacao = ALLOW', filial1.status === 'pendente')

  await asActor(actorCedente)
  await db.query(`select * from public.salvar_conta_estabelecimento_cedente($1,'001','1234','11111-1','corrente',true)`, [filial1.id])
  await asActor(actorGestor)
  const filial1Aprovada = (await db.query(`select * from public.decidir_estabelecimento_gestor($1,'aprovar',null)`, [filial1.id])).rows[0]
  ok('Filial e aprovada normalmente com a permissao habilitada', filial1Aprovada.status === 'aprovado')

  // Gestor desabilita depois -- Filiais existentes permanecem intactas
  const desabilitado = (await db.query(`select * from public.alternar_cadastro_filiais_cedente_gestor($1, false)`, [cedente.id])).rows[0]
  ok('Gestor desabilita a permissao = ALLOW', desabilitado.permite_cadastro_filiais === false)

  const filial1Depois = (await db.query(`select status, ativo from public.cedente_estabelecimentos where id=$1`, [filial1.id])).rows[0]
  ok('Filial aprovada permanece aprovada/ativa apos desabilitar a permissao', filial1Depois.status === 'aprovado' && filial1Depois.ativo === true)

  await asActor(actorCedente)
  const podeOriginarDepois = (await db.query(`select public.estabelecimento_pode_originar($1,$2,$3) permitido`, [filial1.id, cedente.id, fundo])).rows[0].permitido
  ok('Filial aprovada continua apta a originar apos desabilitar a permissao', podeOriginarDepois === true)

  // Tentativa de nova Filial volta a ser DENY
  await expectError('Nova tentativa de cadastro apos desabilitar = DENY', async () => {
    await db.query(`select * from public.cadastrar_filial_cedente($1,$2,$3)`, [cnpjFilial2, 'QA Filial 2', null])
  }, /nao esta habilitado para este Cedente/)

  await db.query('RESET ROLE')
  await db.query('ROLLBACK')
  console.log(JSON.stringify({
    project_ref: apiRef,
    transaction: 'ROLLED_BACK',
    passed: checks.filter((item) => item.status === 'PASS').length,
    failed: checks.filter((item) => item.status === 'FAIL').length,
    checks,
  }, null, 2))
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  console.error(JSON.stringify({ project_ref: apiRef, transaction: 'ROLLED_BACK', error: error instanceof Error ? error.message : String(error), checks }, null, 2))
  process.exitCode = 1
} finally {
  await db.end()
}

async function createAuthUser(id, role) {
  await db.query(`insert into auth.users (
    id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values ($1,'authenticated','authenticated',$2,now(),'{}'::jsonb,$3::jsonb,now(),now())`, [
    id, `qa-permissao-filiais-${id}@example.invalid`, JSON.stringify({ role, nome_completo: `QA ${role}` }),
  ])
}

async function asActor(userId) {
  await db.query('RESET ROLE')
  const claims = { sub: userId, role: 'authenticated', aal: 'aal2', session_id: randomUUID() }
  await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)])
  await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [userId])
  await db.query(`select set_config('request.jwt.claim.role','authenticated',true)`)
  await db.query('SET LOCAL ROLE authenticated')
}

async function expectError(name, callback, pattern) {
  const savepoint = `sp_${checks.length}`
  await db.query(`SAVEPOINT ${savepoint}`)
  try {
    await callback()
    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    ok(name, false, 'A operacao deveria ter sido bloqueada')
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    ok(name, pattern.test(error instanceof Error ? error.message : String(error)), error instanceof Error ? error.message : String(error))
  }
}

function ok(name, condition, evidence = null) {
  checks.push({ name, status: condition ? 'PASS' : 'FAIL', ...(evidence ? { evidence } : {}) })
  if (!condition) throw new Error(`Falha E2E: ${name}${evidence ? ` (${evidence})` : ''}`)
}

function makeCnpj(base12) {
  const digits = base12.replace(/\D/g, '').padStart(12, '0').slice(-12).split('').map(Number)
  const digit = (values, weights) => {
    const rest = values.reduce((sum, value, index) => sum + value * weights[index], 0) % 11
    return rest < 2 ? 0 : 11 - rest
  }
  const d1 = digit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digit([...digits, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${digits.join('')}${d1}${d2}`
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
