import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

export const PERF9A_PREFIX = 'PERF9A_'
export const PERF9A_EMAIL_DOMAIN = 'perf9a.invalid'
export const PERF9A_STORAGE_PREFIX = 'perf9a/'
export const PERF9A_DATASET_VERSION = '9A.1'

export const PERF9A_TABLES = [
  'profiles',
  'fundos',
  'usuario_fundos',
  'cedentes',
  'cedente_fundos',
  'consultor_cedente',
  'sacados',
  'politicas_operacionais',
  'politica_operacional_versoes',
  'cedente_fundo_politicas',
  'politica_requisitos_documentais',
  'taxas_cedente',
  'notas_fiscais',
  'operacoes',
  'operacoes_nfs',
  'nota_fiscal_entregas',
  'eventos_entrega',
  'documentos_repositorio',
  'documento_versoes',
  'documento_vinculos',
  'documento_requisito_instancias',
  'contas_escrow',
  'movimentos_escrow',
  'notificacoes',
  'logs_auditoria',
  'eventos_dominio',
]

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--' || !arg.startsWith('--')) continue

    const raw = arg.slice(2)
    const separatorIndex = raw.indexOf('=')
    const key = separatorIndex >= 0 ? raw.slice(0, separatorIndex) : raw
    const inlineValue = separatorIndex >= 0 ? raw.slice(separatorIndex + 1) : undefined
    const next = argv[index + 1]

    if (inlineValue !== undefined) {
      parsed[key] = inlineValue
    } else if (next && !next.startsWith('--')) {
      parsed[key] = next
      index += 1
    } else {
      parsed[key] = true
    }
  }

  return parsed
}

export function loadEnvFile(envFileArg) {
  const candidates = [
    envFileArg,
    '.env.homolog',
    '.env.local',
    '.env',
  ].filter(Boolean)

  for (const file of candidates) {
    const path = resolve(process.cwd(), file)
    if (!existsSync(path)) continue

    const content = readFileSync(path, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!match) continue

      const [, key, rawValue] = match
      if (process.env[key] !== undefined) continue
      process.env[key] = normalizeEnvValue(rawValue)
    }
  }
}

export function assertHomologEnvironment() {
  const appEnv = String(process.env.NEXT_PUBLIC_APP_ENV || '').trim().toLowerCase()
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const dbUrl = resolveRotatedDbUrl(
    process.env.SUPABASE_DB_URL || process.env.DATABASE_URL,
    process.env.SUPABASE_PASSWORD,
  )

  if (!['homolog', 'homologacao'].includes(appEnv)) {
    throw new Error(`Ambiente bloqueado: NEXT_PUBLIC_APP_ENV precisa identificar homologacao; recebido "${appEnv || 'ausente'}".`)
  }
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_URL nao configurada.')
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY nao configurada.')

  const url = new URL(supabaseUrl)
  const projectRef = url.hostname.split('.')[0]
  if (!projectRef || url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) {
    throw new Error('URL Supabase invalida ou nao reconhecida.')
  }

  return {
    appEnv,
    supabaseUrl,
    serviceRoleKey,
    dbUrl,
    projectRef,
    confirmation: `PERF9A_${projectRef}`,
  }
}

export function resolveRotatedDbUrl(rawDbUrl, rotatedPassword) {
  if (!rawDbUrl || !rotatedPassword) return rawDbUrl

  try {
    const url = new URL(rawDbUrl)
    url.password = rotatedPassword
    return url.toString()
  } catch {
    return rawDbUrl
  }
}

export function assertExplicitConfirmation(value, env) {
  if (value !== env.confirmation) {
    throw new Error(`Confirmacao invalida. Informe exatamente --confirm ${env.confirmation}.`)
  }
}

export function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

export function deterministicUuidExpression(key) {
  return `md5(${sqlText(`BW_ANTECIPA:${PERF9A_DATASET_VERSION}:${key}`)})::uuid`
}

export function createAdminClient(env) {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}

export function getPerf9aLocalDir(...segments) {
  const base = process.env.LOCALAPPDATA || tmpdir()
  const path = resolve(base, 'BWAntecipa', 'perf9a', ...segments)
  mkdirSync(path, { recursive: true, mode: 0o700 })
  return path
}

export function writeRestrictedJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // Windows pode ignorar POSIX mode; o arquivo permanece fora do repositorio.
  }
}

export async function fetchAllRows(supabase, table, pageSize = 1000) {
  const rows = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + pageSize - 1)

    if (error) throw new Error(`Falha ao ler ${table}: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }

  return rows
}

export async function listAllAuthUsers(supabase, pageSize = 1000) {
  const users = []

  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: pageSize })
    if (error) throw new Error(`Falha ao listar usuarios Auth: ${error.message}`)
    users.push(...data.users)
    if (data.users.length < pageSize) break
  }

  return users
}

export function maskDbUrl(dbUrl) {
  if (!dbUrl) return '<nao configurada>'
  try {
    const url = new URL(dbUrl)
    if (url.password) url.password = '***'
    return url.toString()
  } catch {
    return '<db-url invalida>'
  }
}

export async function runSqlFile(env, sql, label) {
  if (!env.dbUrl) {
    throw new Error('SUPABASE_DB_URL ou DATABASE_URL obrigatoria para executar a carga SQL transacional.')
  }

  const { Client } = await import('pg')
  const client = new Client({
    connectionString: env.dbUrl,
    application_name: `bw_antecipa_perf9a_${label}`,
    statement_timeout: 120_000,
    query_timeout: 120_000,
    ssl: { rejectUnauthorized: false },
  })

  try {
    await client.connect()
    return await client.query(sql)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const position = typeof error === 'object' && error && 'position' in error && error.position
      ? ` (posicao ${String(error.position)})`
      : ''
    throw new Error(`Falha na execucao SQL ${label}${position}: ${message}`)
  } finally {
    await client.end().catch(() => undefined)
  }
}

export function printEnvironmentSummary(env) {
  const host = new URL(env.supabaseUrl).host
  console.log(`Ambiente: ${env.appEnv}`)
  console.log(`Projeto: ${env.projectRef}`)
  console.log(`Host: ${host}`)
  console.log(`DB: ${maskDbUrl(env.dbUrl)}`)
}

function normalizeEnvValue(rawValue) {
  const value = rawValue.trim()
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}
