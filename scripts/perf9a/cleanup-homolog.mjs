#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PERF9A_EMAIL_DOMAIN,
  PERF9A_PREFIX,
  assertExplicitConfirmation,
  assertHomologEnvironment,
  createAdminClient,
  deterministicUuidExpression,
  getPerf9aLocalDir,
  listAllAuthUsers,
  loadEnvFile,
  parseArgs,
  printEnvironmentSummary,
  runSqlFile,
} from './common.mjs'
import { collectPerf9aStatus } from './status-homolog.mjs'

const args = parseArgs()

try {
  await main()
} catch (error) {
  console.error(`\nCleanup PERF9A falhou: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

async function main() {
  loadEnvFile(args['env-file'])
  const env = assertHomologEnvironment()
  const admin = createAdminClient(env)
  const execute = args.execute === true
  const status = await collectPerf9aStatus(admin)

  console.log(`\nBW Antecipa - cleanup PERF9A (${execute ? 'EXECUCAO' : 'DRY-RUN'})`)
  printEnvironmentSummary(env)
  console.log(`Prefixo exclusivo: ${PERF9A_PREFIX}`)
  for (const [label, count] of Object.entries(status)) console.log(`- ${label}: ${count}`)

  if (!execute) {
    console.log('\nDry-run concluido. Nenhum registro foi removido.')
    console.log(`Para executar: npm run perf9a:cleanup -- --execute --confirm ${env.confirmation}`)
    return
  }

  assertExplicitConfirmation(args.confirm, env)
  const fundIds = [
    uuidFromExpressionKey('FUNDO_A'),
    uuidFromExpressionKey('FUNDO_B'),
  ]

  for (const fundId of fundIds) {
    const { error } = await admin.rpc('reset_operacional_fundo_homolog', {
      p_fundo_id: fundId,
      p_modo: 'reset',
      p_apagar_notas_fiscais: true,
      p_confirmacao: 'RESETAR_HOMOLOG',
      p_escopo: 'completo',
    })
    if (error) throw new Error(`Reset do fundo sintetico ${fundId} falhou: ${error.message}`)
  }

  await runSqlFile(env, buildStructuralCleanupSql(), 'cleanup')
  await removeStorageObjects(admin)

  const authUsers = await listAllAuthUsers(admin)
  const testUsers = authUsers.filter((user) => user.email?.endsWith(`@${PERF9A_EMAIL_DOMAIN}`))
  for (const user of testUsers) {
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) throw new Error(`Falha ao remover usuario Auth sintetico: ${error.message}`)
  }

  const credentialsPath = resolve(getPerf9aLocalDir('credentials'), `users-${env.projectRef}.json`)
  if (existsSync(credentialsPath)) unlinkSync(credentialsPath)

  const after = await collectPerf9aStatus(admin)
  const residual = Object.entries(after).filter(([, count]) => count !== 0)
  if (residual.length > 0) {
    throw new Error(`Cleanup deixou residuos: ${residual.map(([key, count]) => `${key}=${count}`).join(', ')}`)
  }
  console.log('\nCleanup concluido; apenas registros PERF9A foram removidos.')
}

function buildStructuralCleanupSql() {
  return `BEGIN;
DELETE FROM public.notificacoes WHERE dedupe_key LIKE '${PERF9A_PREFIX}%';
DELETE FROM public.logs_auditoria WHERE origem='perf9a_seed' OR ator_identificador LIKE '${PERF9A_PREFIX}%';
DELETE FROM public.eventos_dominio WHERE origem='perf9a_seed';
DELETE FROM public.movimentos_escrow WHERE descricao LIKE '${PERF9A_PREFIX}%';
DELETE FROM public.contas_escrow WHERE identificador LIKE '${PERF9A_PREFIX}%';
DELETE FROM public.taxas_cedente
WHERE cedente_id IN (SELECT id FROM public.cedentes WHERE razao_social LIKE '${PERF9A_PREFIX}%');
DELETE FROM public.consultor_cedente
WHERE cedente_id IN (SELECT id FROM public.cedentes WHERE razao_social LIKE '${PERF9A_PREFIX}%');
DELETE FROM public.cedente_fundo_politicas
WHERE cedente_fundo_id IN (
  SELECT id FROM public.cedente_fundos WHERE codigo_externo LIKE '${PERF9A_PREFIX}%'
);
DELETE FROM public.cedente_fundos WHERE codigo_externo LIKE '${PERF9A_PREFIX}%';
DELETE FROM public.sacados WHERE razao_social LIKE '${PERF9A_PREFIX}%';
DELETE FROM public.cedentes WHERE razao_social LIKE '${PERF9A_PREFIX}%';
DELETE FROM public.usuario_fundos
WHERE fundo_id IN (SELECT id FROM public.fundos WHERE nome LIKE '${PERF9A_PREFIX}%');
DELETE FROM public.politicas_operacionais WHERE codigo LIKE '${PERF9A_PREFIX}%';
DELETE FROM public.fundos WHERE nome LIKE '${PERF9A_PREFIX}%';
DELETE FROM public.profiles WHERE email LIKE '%@${PERF9A_EMAIL_DOMAIN}';
COMMIT;
`
}

async function removeStorageObjects(admin) {
  const { data: buckets, error: bucketError } = await admin.storage.listBuckets()
  if (bucketError) throw new Error(`Falha ao listar buckets: ${bucketError.message}`)

  for (const bucket of buckets || []) {
    const paths = await collectObjectPaths(admin, bucket.name, 'perf9a')
    if (paths.length === 0) continue
    const { error } = await admin.storage.from(bucket.name).remove(paths)
    if (error) throw new Error(`Falha ao limpar Storage ${bucket.name}: ${error.message}`)
  }
}

async function collectObjectPaths(admin, bucket, prefix) {
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error && !/not found/i.test(error.message)) throw error
  const paths = []
  for (const entry of data || []) {
    const path = `${prefix}/${entry.name}`
    if (entry.id) paths.push(path)
    else paths.push(...await collectObjectPaths(admin, bucket, path))
  }
  return paths
}

function uuidFromExpressionKey(key) {
  const expression = deterministicUuidExpression(key)
  const match = expression.match(/^md5\\('([^']+)'\\)::uuid$/)
  if (!match) throw new Error(`Expressao UUID inesperada para ${key}`)
  return md5ToUuid(match[1])
}

function md5ToUuid(value) {
  const hash = createHash('md5').update(value).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`
}
