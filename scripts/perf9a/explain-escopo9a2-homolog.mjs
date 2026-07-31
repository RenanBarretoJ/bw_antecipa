#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createAdminClient, assertHomologEnvironment, getPerf9aLocalDir, loadEnvFile, writeRestrictedJson } from './common.mjs'

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main()
  } catch (error) {
    console.error(`EXPLAIN Escopo 9A.2 falhou: ${safeError(error)}`)
    process.exitCode = 1
  }
}

async function main() {
  loadEnvFile('.env.homolog')
  const env = assertHomologEnvironment()
  if (!env.dbUrl) throw new Error('SUPABASE_DB_URL ausente para EXPLAIN homolog.')
  const admin = createAdminClient(env)
  const credentials = JSON.parse(readFileSync(resolve(getPerf9aLocalDir('credentials'), `users-${env.projectRef}.json`), 'utf8'))
  const gestor = await getProfileId(admin, credentials, 'gestor_a')
  const consultor = await getProfileId(admin, credentials, 'consultor_a')
  const fixtures = await loadFixtureIds(admin)
  const { Client } = await import('pg')
  const client = new Client({ connectionString: env.dbUrl, application_name: 'bw_antecipa_perf9a2_explain', statement_timeout: 120_000, query_timeout: 120_000, ssl: { rejectUnauthorized: false } })
  await client.connect()
  const plans = []
  try {
    plans.push(await explain(client, 'movimentos_escrow_conta_cursor', gestor, `select id, created_at, valor from public.movimentos_escrow where conta_escrow_id = '${fixtures.escrowAccount}' order by created_at desc, id desc limit 50`))
    plans.push(await explain(client, 'operacoes_nfs_por_nf', gestor, `select operacao_id, nota_fiscal_id from public.operacoes_nfs where nota_fiscal_id = '${fixtures.invoiceA}' order by operacao_id`))
    plans.push(await explain(client, 'operacoes_por_vinculo_status_data', gestor, `select o.id, o.status, o.created_at from public.operacoes o join public.cedente_fundos cf on cf.id = o.cedente_fundo_id where cf.id = '${fixtures.linkA}' and o.status is not null order by o.created_at desc, o.id desc limit 50`))
    plans.push(await explain(client, 'notas_por_vinculo_status_data', gestor, `select id, status, created_at from public.notas_fiscais where cedente_fundo_id = '${fixtures.linkA}' and status is not null order by created_at desc, id desc limit 50`))
    plans.push(await explain(client, 'notificacoes_usuario_cursor', gestor, `select id, created_at, lida from public.notificacoes where usuario_id = '${gestor}' order by created_at desc, id desc limit 40`))
    plans.push(await explain(client, 'notificacoes_usuario_lidas_cursor', gestor, `select id, created_at, lida from public.notificacoes where usuario_id = '${gestor}' and lida = false order by created_at desc, id desc limit 40`))
    plans.push(await explain(client, 'auditoria_cursor', gestor, `select id, created_at, tipo_evento, entidade_tipo from public.logs_auditoria order by created_at desc, id desc limit 40`))
    plans.push(await explain(client, 'auditoria_entidade', gestor, `select id, created_at, tipo_evento from public.logs_auditoria where entidade_tipo = 'nota_fiscal' and entidade_id = '${fixtures.invoiceA}' order by created_at desc, id desc limit 40`))
    plans.push(await explain(client, 'onboarding_rpc', gestor, `select public.listar_onboarding_cedentes_paginado('${fixtures.fundA}', 1, 20, null, 'todos', null, null, 'created_at', 'desc')`))
    plans.push(await explain(client, 'dashboard_gestor_rpc', gestor, `select public.dashboard_gestor_resumo('${fixtures.fundA}')`))
    plans.push(await explain(client, 'dashboard_cedente_rpc', fixtures.cedenteAUser, `select public.dashboard_cedente_resumo('${fixtures.linkA}')`))
    plans.push(await explain(client, 'dashboard_consultor_rpc', consultor, `select public.dashboard_consultor_resumo()`))
    plans.push(await explain(client, 'dashboard_sacado_rpc', fixtures.sacadoAUser, `select public.carregar_dashboard_sacado()`))
    plans.push(await explain(client, 'relatorio_gestor_rpc', gestor, `select public.relatorio_gestor_analitico('${fixtures.fundA}', '2026-07', null, null, null, null, null, 0, 20, 'volume_total', 'desc')`))
    plans.push(await explain(client, 'relatorio_consultor_rpc', consultor, `select public.relatorio_consultor_analitico('2026-07', null, null, null, null, null, 0, 20, 'volume_total', 'desc')`))
  } finally {
    await client.end()
  }

  const evidencePath = resolve(getPerf9aLocalDir('evidence'), `explain-escopo9a2-${env.projectRef}-${new Date().toISOString().replaceAll(':', '-')}.json`)
  writeRestrictedJson(evidencePath, { scope: '9A.2', gate: 'explain-post-volume', projectRef: env.projectRef, executedAt: new Date().toISOString(), plans })
  console.log(`EXPLAIN pos-volume concluido. Evidencia local restrita: ${evidencePath}`)
  for (const item of plans) console.log(`${item.name}: ${item.summary?.executionTimeMs ?? 'erro'} ms, ${item.summary?.actualRows ?? '-'} linhas, ${item.summary?.nodeTypes?.join(', ') || item.error || 'sem plano'}`)
}

async function explain(client, name, userId, sql) {
  await client.query('BEGIN')
  try {
    await client.query('SET LOCAL ROLE authenticated')
    await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)")
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId])
    const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)
    await client.query('ROLLBACK')
    const plan = result.rows[0]['QUERY PLAN']?.[0]?.Plan
    return { name, sql, summary: summarizePlan(plan), plan: result.rows[0]['QUERY PLAN'] }
  } catch (error) {
    await client.query('ROLLBACK')
    return { name, sql, error: safeError(error) }
  }
}

function summarizePlan(plan) {
  if (!plan) return null
  const nodes = []
  let actualRows = null
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node['Node Type']) nodes.push(node['Node Type'])
    if (typeof node['Actual Rows'] === 'number') actualRows = Math.max(actualRows ?? 0, node['Actual Rows'])
    for (const child of node.Plans || []) visit(child)
  }
  visit(plan)
  return { executionTimeMs: plan['Execution Time'] ?? plan['Actual Total Time'] ?? null, actualRows, nodeTypes: [...new Set(nodes)], sharedReadBlocks: plan['Shared Read Blocks'] ?? null, sharedHitBlocks: plan['Shared Hit Blocks'] ?? null }
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
  const fundA = funds.find((item) => item.nome === 'PERF9A_FUNDO A').id
  const { data: cedentes, error: cedenteError } = await admin.from('cedentes').select('id,razao_social,user_id').in('razao_social', ['PERF9A_CEDENTE A 1', 'PERF9A_CEDENTE B 61'])
  if (cedenteError || cedentes?.length !== 2) throw new Error(`Cedentes PERF9A ausentes: ${cedenteError?.message || cedentes?.length}`)
  const cedenteA = cedentes.find((item) => item.razao_social === 'PERF9A_CEDENTE A 1')
  const { data: sacados, error: sacadoError } = await admin.from('sacados').select('user_id').limit(1)
  if (sacadoError || !sacados?.[0]) throw new Error(`Sacado PERF9A ausente: ${sacadoError?.message || 'sem registro'}`)
  const { data: link, error: linkError } = await admin.from('cedente_fundos').select('id').eq('cedente_id', cedenteA.id).eq('fundo_id', fundA).eq('status', 'ativo').single()
  if (linkError) throw new Error(`Vinculo A ausente: ${linkError.message}`)
  const { data: invoice, error: invoiceError } = await admin.from('notas_fiscais').select('id').eq('cedente_fundo_id', link.id).limit(1).single()
  if (invoiceError) throw new Error(`NF A ausente: ${invoiceError.message}`)
  const { data: escrow, error: escrowError } = await admin.from('contas_escrow').select('id').eq('cedente_id', cedenteA.id).limit(1).single()
  if (escrowError) throw new Error(`Escrow A ausente: ${escrowError.message}`)
  return { fundA, linkA: link.id, invoiceA: invoice.id, escrowAccount: escrow.id, cedenteAUser: cedenteA.user_id, sacadoAUser: sacados[0].user_id }
}

function safeError(error) { return (error instanceof Error ? error.message : String(error)).replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://***').replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>') }
