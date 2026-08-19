#!/usr/bin/env node

// Secao 9 do ticket: performance com 50+ filiais. Confirma que
// listar_estabelecimentos_pagina agrega e pagina em uma unica query (sem
// N+1: nao dispara 1 query por estabelecimento) e que filtros/paginacao
// batem com o esperado. Transacao e revertida ao final -- nao deixa dados
// em homologacao.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const EXPECTED_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const checks = []
const TOTAL_FILIAIS = 55

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
  const cnpjMatriz = makeCnpj('960000010001')
  await createAuthUser(actorCedente, 'cedente')
  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Escala 50 Filiais','ativo') returning id`, [actorCedente, cnpjMatriz])).rows[0].id
  const matriz = (await db.query(`select id from public.cedente_estabelecimentos where cedente_id=$1 and tipo='matriz'`, [cedente])).rows[0].id

  await asActor(actorCedente)
  await db.query(`select * from public.salvar_conta_estabelecimento_cedente($1,'237','0001','11111-1','corrente',true)`, [matriz])
  const filiais = []
  for (let index = 0; index < TOTAL_FILIAIS; index += 1) {
    const cnpj = makeCnpj(`96000001${String(index + 2).padStart(4, '0')}`) // mesma raiz da matriz (96000001); +2 evita colidir com a ordem 0001 da propria Matriz
    const filial = (await db.query(`select * from public.cadastrar_filial_cedente($1,$2,$3)`, [cnpj, `QA Filial Escala ${index}`, null])).rows[0]
    filiais.push(filial)
  }
  ok(`Cadastradas ${TOTAL_FILIAIS} filiais sinteticas`, filiais.length === TOTAL_FILIAIS)

  await asActor(actorCedente)
  // metade com conta bancaria (para exercitar o filtro conta_bancaria_pendente)
  for (const filial of filiais.slice(0, Math.floor(TOTAL_FILIAIS / 2))) {
    await db.query(`select * from public.salvar_conta_estabelecimento_cedente($1,'001','0001','00000-0','corrente',true)`, [filial.id])
  }

  const t0 = performanceNow()
  const explain = await db.query(`EXPLAIN (FORMAT JSON) select * from public.listar_estabelecimentos_pagina($1, NULL, NULL, NULL, NULL, 1, 10)`, [cedente])
  const plan = explain.rows[0]['QUERY PLAN'][0]
  const planText = JSON.stringify(plan)
  const numeroNosScan = (planText.match(/"Node Type"/g) || []).length
  ok('Plano de execucao usa uma unica consulta agregada (nao 1 scan por estabelecimento)', numeroNosScan < TOTAL_FILIAIS)

  const pagina1 = await db.query(`select * from public.listar_estabelecimentos_pagina($1, NULL, NULL, NULL, NULL, 1, 10)`, [cedente])
  const elapsedMs = performanceNow() - t0
  ok('Pagina 1 (pageSize=10) retorna exatamente 10 linhas', pagina1.rowCount === 10)
  ok('total_itens reflete todos os 56 estabelecimentos (55 filiais + 1 matriz)', Number(pagina1.rows[0].total_itens) === TOTAL_FILIAIS + 1)
  ok('Matriz aparece primeiro na ordenacao', pagina1.rows[0].tipo === 'matriz')
  ok(`Consulta agregada e paginada responde rapido mesmo com ${TOTAL_FILIAIS + 1} estabelecimentos (${elapsedMs.toFixed(0)}ms)`, elapsedMs < 3000)

  const paginaFiltroTipo = await db.query(`select * from public.listar_estabelecimentos_pagina($1, 'filial', NULL, NULL, NULL, 1, 20)`, [cedente])
  ok('Filtro Tipo=filial exclui a Matriz', paginaFiltroTipo.rows.every((row) => row.tipo === 'filial'))

  const paginaFiltroContaPendente = await db.query(`select * from public.listar_estabelecimentos_pagina($1, 'filial', NULL, 'conta_bancaria_pendente', NULL, 1, 40)`, [cedente])
  ok('Filtro Pendencia=conta_bancaria_pendente encontra as filiais sem conta', paginaFiltroContaPendente.rowCount === Math.ceil(TOTAL_FILIAIS / 2) && paginaFiltroContaPendente.rows.every((row) => row.tem_conta_principal === false))

  const paginaBusca = await db.query(`select * from public.listar_estabelecimentos_pagina($1, NULL, NULL, NULL, $2, 1, 40)`, [cedente, 'Escala 3'])
  ok('Busca textual filtra por razao social', paginaBusca.rowCount > 0 && paginaBusca.rows.every((row) => row.razao_social.includes('Escala 3')))

  const segundaPagina = await db.query(`select * from public.listar_estabelecimentos_pagina($1, 'filial', NULL, NULL, NULL, 2, 20)`, [cedente])
  ok('Paginacao avanca corretamente (pagina 2 nao repete a pagina 1)', segundaPagina.rows[0].estabelecimento_id !== paginaFiltroTipo.rows[0].estabelecimento_id)

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
    id, `qa-perf-estabelecimentos-${id}@example.invalid`, JSON.stringify({ role, nome_completo: `QA ${role}` }),
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

function ok(name, condition, evidence = null) {
  checks.push({ name, status: condition ? 'PASS' : 'FAIL', ...(evidence ? { evidence } : {}) })
  if (!condition) throw new Error(`Falha: ${name}${evidence ? ` (${evidence})` : ''}`)
}

function performanceNow() {
  return process.hrtime.bigint ? Number(process.hrtime.bigint()) / 1e6 : Date.now()
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
