#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createAdminClient } from './common.mjs'
import { assertHomologEnvironment, getPerf9aLocalDir, loadEnvFile, writeRestrictedJson } from './common.mjs'

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main()
  } catch (error) {
    console.error(`\nEXPLAIN Escopo 9B falhou: ${safeError(error)}\n`)
    process.exitCode = 1
  }
}

async function main() {
  loadEnvFile()
  const env = assertHomologEnvironment()
  if (!env.dbUrl) throw new Error('SUPABASE_DB_URL ausente para EXPLAIN homolog.')
  const admin = createAdminClient(env)
  const credentials = JSON.parse(readFileSync(resolve(getPerf9aLocalDir('credentials'), `users-${env.projectRef}.json`), 'utf8'))
  const gestor = await getProfileId(admin, credentials, 'gestor_a')
  const consultor = await getProfileId(admin, credentials, 'consultor_a')
  const fixtures = await loadFixtureIds(admin)
  const { Client } = await import('pg')
  const client = new Client({ connectionString: env.dbUrl, application_name: 'bw_antecipa_perf9b_explain', ssl: { rejectUnauthorized: false } })
  await client.connect()
  const plans = []
  try {
    plans.push(await explain(client, 'gestor_a_fundo_B', gestor, `select id from public.fundos where id = '${fixtures.fundB}'`))
    plans.push(await explain(client, 'gestor_a_operacao_B', gestor, `select id from public.operacoes where id = '${fixtures.operationB}'`))
    plans.push(await explain(client, 'gestor_a_nf_B', gestor, `select id from public.notas_fiscais where id = '${fixtures.invoiceB}'`))
    plans.push(await explain(client, 'consultor_a_cedente_B', consultor, `select id from public.cedentes where id = '${fixtures.cedenteB}'`))
    plans.push(await explain(client, 'consultor_a_nf_B', consultor, `select id from public.notas_fiscais where id = '${fixtures.invoiceB}'`))
  } finally {
    await client.end()
  }
  const path = resolve(getPerf9aLocalDir('evidence'), `explain-escopo9b-${env.projectRef}-${new Date().toISOString().replaceAll(':', '-')}.json`)
  writeRestrictedJson(path, { projectRef: env.projectRef, executedAt: new Date().toISOString(), scope: '9B', role: 'authenticated', plans })
  console.log(`EXPLAIN autenticado concluido. Evidencia local restrita: ${path}`)
}

async function explain(client, name, userId, sql) {
  await client.query('BEGIN')
  try {
    await client.query('SET LOCAL ROLE authenticated')
    await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)")
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId])
    const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)
    await client.query('ROLLBACK')
    return { name, sql, plan: result.rows[0]['QUERY PLAN'] }
  } catch (error) {
    await client.query('ROLLBACK')
    return { name, sql, error: safeError(error) }
  }
}

async function getProfileId(admin, credentials, key) {
  const credential = credentials.users.find((item) => item.key === key)
  if (!credential) throw new Error(`Credencial local ausente para ${key}.`)
  const { data, error } = await admin.from('profiles').select('id').eq('email', credential.email).single()
  if (error) throw new Error(`Perfil ausente para ${key}: ${error.message}`)
  return data.id
}

async function loadFixtureIds(admin) {
  const { data: funds, error: fundError } = await admin.from('fundos').select('id,nome').in('nome', ['PERF9A_FUNDO A', 'PERF9A_FUNDO B'])
  if (fundError || funds?.length !== 2) throw new Error(`Fundos PERF9A ausentes: ${fundError?.message || funds?.length}`)
  const fundB = funds.find((item) => item.nome === 'PERF9A_FUNDO B').id
  const { data: cedentes, error: cedenteError } = await admin.from('cedentes').select('id,razao_social').in('razao_social', ['PERF9A_CEDENTE A 1', 'PERF9A_CEDENTE B 61'])
  if (cedenteError || cedentes?.length !== 2) throw new Error(`Cedentes PERF9A ausentes: ${cedenteError?.message || cedentes?.length}`)
  const cedenteB = cedentes.find((item) => item.razao_social === 'PERF9A_CEDENTE B 61').id
  const { data: linkB, error: linkError } = await admin.from('cedente_fundos').select('id').eq('cedente_id', cedenteB).eq('fundo_id', fundB).eq('status', 'ativo').single()
  if (linkError) throw new Error(`Vinculo B ausente: ${linkError.message}`)
  const { data: operationB, error: operationError } = await admin.from('operacoes').select('id').eq('cedente_fundo_id', linkB.id).limit(1).single()
  if (operationError) throw new Error(`Operacao B ausente: ${operationError.message}`)
  const { data: invoiceB, error: invoiceError } = await admin.from('notas_fiscais').select('id').eq('fundo_id', fundB).eq('cedente_fundo_id', linkB.id).limit(1).single()
  if (invoiceError) throw new Error(`NF B ausente: ${invoiceError.message}`)
  return { fundB, cedenteB, operationB: operationB.id, invoiceB: invoiceB.id }
}

function safeError(error) {
  if (!(error instanceof Error)) return String(error)
  return error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://***').replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>')
}
