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
  const cnpjMatriz = makeCnpj('980000010001') // raiz 98000001
  await createAuthUser(actorCedente, 'cedente')
  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Raiz CNPJ','ativo') returning id`, [actorCedente, cnpjMatriz])).rows[0].id
  const matriz = (await db.query(`select id, cnpj from public.cedente_estabelecimentos where cedente_id=$1 and tipo='matriz'`, [cedente])).rows[0]
  ok('Matriz criada com a raiz esperada (98000001)', matriz.cnpj.startsWith('98000001'))

  await asActor(actorCedente)

  // 1) mesma raiz + CNPJ valido = ALLOW
  const cnpjFilialMesmaRaiz = makeCnpj('980000010002')
  const filial = (await db.query(`select * from public.cadastrar_filial_cedente($1,$2,$3)`, [cnpjFilialMesmaRaiz, 'QA Filial Mesma Raiz', null])).rows[0]
  ok('Mesma raiz + CNPJ valido = ALLOW', filial.status === 'pendente' && filial.cnpj === cnpjFilialMesmaRaiz)

  // 2) raiz diferente = DENY
  await expectError('Raiz diferente = DENY', async () => {
    const cnpjRaizDiferente = makeCnpj('990000010002')
    await db.query(`select * from public.cadastrar_filial_cedente($1,$2,$3)`, [cnpjRaizDiferente, 'QA Filial Raiz Diferente', null])
  }, /nao pertence a mesma raiz da Matriz/)

  // 3) mesmo CNPJ da Matriz = DENY
  await expectError('Mesmo CNPJ da Matriz = DENY', async () => {
    await db.query(`select * from public.cadastrar_filial_cedente($1,$2,$3)`, [cnpjMatriz, 'QA Tentativa com CNPJ da Matriz', null])
  }, /ja cadastrado/)

  // 4) CNPJ ja existente (outra filial do mesmo cedente) = idempotente (retorna a mesma linha, nao duplica)
  const filialRepetida = (await db.query(`select * from public.cadastrar_filial_cedente($1,$2,$3)`, [cnpjFilialMesmaRaiz, 'QA Filial Mesma Raiz', null])).rows[0]
  ok('CNPJ ja existente da mesma Filial = idempotente (nao duplica registro)', filialRepetida.id === filial.id)

  // 5) CNPJ invalido = DENY
  await expectError('CNPJ invalido = DENY', async () => {
    await db.query(`select * from public.cadastrar_filial_cedente($1,$2,$3)`, ['11111111111111', 'QA Filial CNPJ Invalido', null])
  }, /invalido/)

  // 6) helper de raiz: normalizacao e comparacao case-insensitive com CNPJ alfanumerico (unitario --
  //    cnpj_valido/CHECK constraint ainda exigem 14 digitos numericos; ver relatorio).
  // private.raiz_cnpj e revogada de PUBLIC/authenticated de proposito (so e chamada
  // internamente por RPC/trigger SECURITY DEFINER); testar como role privilegiada.
  await db.query('RESET ROLE')
  const raizNumericaComPontuacao = await db.query(`select private.raiz_cnpj('07.312.248/0001-37') raiz`)
  ok('raiz_cnpj remove pontuacao e mantem apenas as 8 primeiras posicoes', raizNumericaComPontuacao.rows[0].raiz === '07312248')

  const raizAlfaMinuscula = await db.query(`select private.raiz_cnpj('12.abc.345/0001-90') raiz`)
  const raizAlfaMaiuscula = await db.query(`select private.raiz_cnpj('12.ABC.345/0002-11') raiz`)
  ok('raiz_cnpj alfanumerico com mesma raiz compara igual (case-insensitive) = ALLOW logico', raizAlfaMinuscula.rows[0].raiz === raizAlfaMaiuscula.rows[0].raiz && raizAlfaMinuscula.rows[0].raiz === '12ABC345')

  const raizAlfaDiferente = await db.query(`select private.raiz_cnpj('99.XYZ.000/0001-00') raiz`)
  ok('raiz_cnpj alfanumerico com raiz diferente compara diferente = DENY logico', raizAlfaDiferente.rows[0].raiz !== raizAlfaMinuscula.rows[0].raiz)

  // 7) tentativa por caminho DB alternativo (INSERT direto via service_role, contornando a RPC) = protegida pelo trigger
  await db.query('RESET ROLE')
  await expectError('Tentativa via INSERT direto (bypass da RPC) = protegida pelo trigger', async () => {
    await db.query(`insert into public.cedente_estabelecimentos (cedente_id, cnpj, razao_social, tipo, matriz_estabelecimento_id, status, ativo)
      values ($1,$2,'QA Bypass Trigger','filial',$3,'pendente',true)`, [cedente, makeCnpj('999999990002'), matriz.id])
  }, /nao pertence a mesma raiz da Matriz/)

  // 8) nenhum registro parcial criado em falha -- confirma contagem de filiais permanece 1 (so a valida)
  await asActor(actorCedente)
  const totalFiliais = await db.query(`select count(*)::int quantidade from public.cedente_estabelecimentos where cedente_id=$1 and tipo='filial'`, [cedente])
  ok('Nenhum registro parcial criado pelas tentativas bloqueadas (apenas 1 Filial valida existe)', totalFiliais.rows[0].quantidade === 1)

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
    id, `qa-raiz-cnpj-${id}@example.invalid`, JSON.stringify({ role, nome_completo: `QA ${role}` }),
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
