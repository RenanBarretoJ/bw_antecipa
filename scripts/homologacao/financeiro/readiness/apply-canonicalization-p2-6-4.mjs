#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HOMOLOG_REF = 'fhgkmggthxikfpogrvaa'
const INITIAL_EXPECTED = [
  '20260817150505_p2_6_4_canonicalizar_schema_funcional.sql',
  '20260817150507_p2_6_4_canonicalizar_acl_rls.sql',
  '20260817150510_p2_6_4_canonicalizar_storage.sql',
]
const FOLLOW_UP_EXPECTED = ['20260817152140_p2_6_4_fechar_acl_rotinas_internas.sql']
const followUp = process.argv.includes('--follow-up')
const EXPECTED = followUp ? FOLLOW_UP_EXPECTED : INITIAL_EXPECTED
const CLI_PATH = resolve('node_modules/supabase/dist/supabase.js')
const artifactPath = resolve(followUp
  ? 'docs/financeiro/deployment-p2-6-4-follow-up.json'
  : 'docs/financeiro/deployment-p2-6-4.json')

if (!process.version.startsWith('v22.')) throw new Error(`Node 22 obrigatorio; recebido ${process.version}.`)
if (run('git', ['branch', '--show-current']).stdout.trim() !== 'homolog') throw new Error('Branch homolog obrigatoria.')
const preflight = JSON.parse(readFileSync(resolve('docs/financeiro/homolog-preflight-p2-6-4.json'), 'utf8'))
if (preflight.status !== 'PASS') throw new Error('Preflight P2.6.4 nao esta aprovado.')
const pending = preflight.migration_history.missing_remote.map((item) => item.filename)
if (!followUp && JSON.stringify(pending) !== JSON.stringify(EXPECTED)) throw new Error(`Migrations pendentes inesperadas: ${pending.join(', ')}.`)
if (followUp) {
  const initial = JSON.parse(readFileSync(resolve('docs/financeiro/deployment-p2-6-4.json'), 'utf8'))
  if (initial.status !== 'PASS') throw new Error('Deployment inicial P2.6.4 nao esta aprovado.')
}

const dbUrl = loadHomologDbUrl()
const result = {
  schema: 'bw-antecipa-p2-6-4-deployment-v1',
  status: 'RUNNING',
  started_at: new Date().toISOString(),
  node: process.version,
  environment: { project_ref: HOMOLOG_REF, production_mutated: false },
  expected_migrations: EXPECTED,
  dry_run: null,
  push: null,
}

try {
  const dryRun = run(process.execPath, [CLI_PATH, 'db', 'push', '--dry-run', '--db-url', dbUrl, '--yes'], true)
  result.dry_run = { status: dryRun.status === 0 ? 'PASS' : 'FAIL', output: sanitize(dryRun.combined) }
  if (dryRun.status !== 0 || !EXPECTED.every((name) => dryRun.combined.includes(name))) {
    throw new Error(`Dry-run nao confirmou exclusivamente as migrations P2.6.4: ${sanitize(dryRun.combined)}`)
  }
  const push = run(process.execPath, [CLI_PATH, 'db', 'push', '--db-url', dbUrl, '--yes'], true)
  result.push = { status: push.status === 0 ? 'PASS' : 'FAIL', output: sanitize(push.combined) }
  if (push.status !== 0) throw new Error(`db push falhou: ${sanitize(push.combined)}`)
  result.status = 'PASS'
} catch (error) {
  result.status = 'FAIL'
  result.failure = sanitize(error instanceof Error ? error.message : error)
  throw error
} finally {
  result.finished_at = new Date().toISOString()
  writeFileSync(artifactPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}

console.log(JSON.stringify({ status: result.status, project_ref: HOMOLOG_REF, migrations: EXPECTED, output: artifactPath }, null, 2))

function loadHomologDbUrl() {
  const env = new Map()
  for (const line of readFileSync(resolve('.env.homolog'), 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (match) env.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ''))
  }
  const value = env.get('SUPABASE_DB_URL') || env.get('DATABASE_URL')
  if (!value) throw new Error('URL de homologacao ausente.')
  const url = new URL(value)
  const ref = decodeURIComponent(url.username).match(/^postgres[.]([a-z0-9]+)$/i)?.[1]
    || url.hostname.match(/^db[.]([a-z0-9]+)[.]supabase[.]co$/i)?.[1]
  if (ref !== HOMOLOG_REF) throw new Error('Projeto remoto diferente da homologacao autorizada.')
  return value
}

function run(command, args, allowFailure = false) {
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
  delete env.DATABASE_URL
  delete env.SUPABASE_DB_URL
  delete env.SUPABASE_ACCESS_TOKEN
  const child = spawnSync(command, args, { cwd: process.cwd(), env, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024, timeout: 900_000 })
  if (child.error) throw child.error
  const combined = [child.stdout, child.stderr].filter(Boolean).join('\n').trim()
  if ((child.status ?? 1) !== 0 && !allowFailure) throw new Error(`${command} falhou: ${sanitize(combined)}`)
  return { status: child.status ?? 1, stdout: child.stdout || '', stderr: child.stderr || '', combined }
}

function sanitize(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[DATABASE_URL_REDACTED]')
    .replace(/(password|service_role|access_token)\s*[=:]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/\u001b\[[0-9;]*m/g, '')
}
