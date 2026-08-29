#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import {
  PERF9A_EMAIL_DOMAIN,
  PERF9A_PREFIX,
  assertHomologEnvironment,
  createAdminClient,
  listAllAuthUsers,
  loadEnvFile,
  parseArgs,
  printEnvironmentSummary,
} from './common.mjs'

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = parseArgs()

  try {
    loadEnvFile(args['env-file'])
    const env = assertHomologEnvironment()
    const admin = createAdminClient(env)
    const status = await collectPerf9aStatus(admin)

    console.log('\nBW Antecipa - status da massa PERF9A')
    printEnvironmentSummary(env)
    for (const [label, count] of Object.entries(status)) {
      console.log(`- ${label}: ${count}`)
    }
  } catch (error) {
    console.error(`\nConsulta PERF9A falhou: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

export async function collectPerf9aStatus(admin) {
  const authUsersPromise = listAllAuthUsers(admin)
  const descriptors = [
    ['fundos', 'fundos', (query) => query.ilike('nome', `${PERF9A_PREFIX}%`)],
    ['cedentes', 'cedentes', (query) => query.ilike('razao_social', `${PERF9A_PREFIX}%`)],
    ['vinculos_cedente_fundo', 'cedente_fundos', (query) => query.ilike('codigo_externo', `${PERF9A_PREFIX}%`)],
    ['politicas', 'politicas_operacionais', (query) => query.ilike('codigo', `${PERF9A_PREFIX}%`)],
    ['operacoes', 'operacoes', (query) => query.ilike('solicitacao_idempotency_key', `${PERF9A_PREFIX}%`)],
    ['notas_fiscais', 'notas_fiscais', (query) => query.ilike('numero_nf', `${PERF9A_PREFIX}%`)],
    ['documentos', 'documento_versoes', (query) => query.ilike('path', 'perf9a/%')],
    ['contas_escrow', 'contas_escrow', (query) => query.ilike('identificador', `${PERF9A_PREFIX}%`)],
    ['movimentos_escrow', 'movimentos_escrow', (query) => query.ilike('descricao', `${PERF9A_PREFIX}%`)],
    ['notificacoes', 'notificacoes', (query) => query.ilike('dedupe_key', `${PERF9A_PREFIX}%`)],
    ['auditoria', 'logs_auditoria', (query) => query.eq('origem', 'perf9a_seed')],
    ['eventos_dominio', 'eventos_dominio', (query) => query.eq('origem', 'perf9a_seed')],
  ]

  const entries = await Promise.all(descriptors.map(async ([label, table, applyFilter]) => {
    const base = admin.from(table).select('*', { count: 'exact', head: true })
    const { count, error } = await applyFilter(base)
    if (error) throw new Error(`Falha ao contar ${table}: ${error.message}`)
    return [label, count || 0]
  }))
  const authUsers = await authUsersPromise
  entries.unshift([
    'usuarios_auth',
    authUsers.filter((user) => user.email?.endsWith(`@${PERF9A_EMAIL_DOMAIN}`)).length,
  ])
  return Object.fromEntries(entries)
}
