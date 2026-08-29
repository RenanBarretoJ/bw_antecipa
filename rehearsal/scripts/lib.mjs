import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const REHEARSAL_ROOT = path.join(REPOSITORY_ROOT, 'rehearsal')
export const SNAPSHOT_DIR = path.join(REHEARSAL_ROOT, 'snapshots', 'current')
export const REPORT_DIR = path.join(REHEARSAL_ROOT, 'reports')
export const TMP_DIR = path.join(REHEARSAL_ROOT, 'tmp')
export const LOCAL_PROJECT_ID = 'bw-antecipa-prod-rehearsal'
export const LOCAL_DB = Object.freeze({
  host: '127.0.0.1',
  port: 55322,
  user: 'postgres',
  password: 'postgres',
  database: 'postgres',
})
export const PRODUCTION_PROJECT_REF = 'wwsndnuvnjuabpbjwlck'
export const HOMOLOG_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
export const POSTGRES_IMAGE = 'postgres:17-alpine'

const SECRET_PATTERNS = [
  /(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi,
  /(password|secret|token|service_role|apikey|api_key)(\s*[=:]\s*)[^\s,;]+/gi,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
]

export function sanitizeText(value) {
  let sanitized = String(value ?? '')
  sanitized = sanitized.replace(SECRET_PATTERNS[0], '$1***@')
  sanitized = sanitized.replace(SECRET_PATTERNS[1], '$1$2***')
  sanitized = sanitized.replace(SECRET_PATTERNS[2], '***JWT***')
  return sanitized
}

export function ensureRuntimeDirectories() {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  fs.mkdirSync(TMP_DIR, { recursive: true })
}

export function loadRehearsalEnv() {
  const envPath = path.join(REPOSITORY_ROOT, '.env.rehearsal.local')
  if (!fs.existsSync(envPath)) return { ...process.env }

  const parsed = {}
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    parsed[key] = value
  }
  return { ...process.env, ...parsed }
}

export function extractProjectRef(databaseUrl) {
  const parsed = new URL(databaseUrl)
  const directMatch = parsed.hostname.match(/^db\.([a-z0-9]{20})\.supabase\.co$/u)
  if (directMatch) return directMatch[1]
  const userMatch = decodeURIComponent(parsed.username).match(/^postgres\.([a-z0-9]{20})$/u)
  return userMatch?.[1] ?? null
}

export function assertProductionReadOnlyConfig(env) {
  const databaseUrl = env.REHEARSAL_PRODUCTION_DB_URL
  const declaredRef = env.REHEARSAL_PRODUCTION_PROJECT_REF
  const expectedConfirmation = `EXPORTAR_SOMENTE_LEITURA_${PRODUCTION_PROJECT_REF}`

  if (!databaseUrl) throw new Error('Defina REHEARSAL_PRODUCTION_DB_URL em .env.rehearsal.local.')
  if (declaredRef !== PRODUCTION_PROJECT_REF) throw new Error('O project ref declarado nao corresponde a producao auditada.')
  if (env.REHEARSAL_CONFIRM_EXPORT !== expectedConfirmation) {
    throw new Error(`Confirme a exportacao read-only com REHEARSAL_CONFIRM_EXPORT=${expectedConfirmation}.`)
  }

  const parsed = new URL(databaseUrl)
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('A URL deve usar o protocolo PostgreSQL.')
  if (['localhost', '127.0.0.1', 'host.docker.internal'].includes(parsed.hostname)) {
    throw new Error('A exportacao exige uma origem remota de producao explicitamente confirmada.')
  }
  const detectedRef = extractProjectRef(databaseUrl)
  if (detectedRef !== PRODUCTION_PROJECT_REF || detectedRef === HOMOLOG_PROJECT_REF) {
    throw new Error('O host/usuario da conexao nao identifica a producao auditada.')
  }

  return { databaseUrl, parsed, projectRef: detectedRef }
}

export function assertLocalTarget(config = LOCAL_DB) {
  if (!['127.0.0.1', 'localhost', 'host.docker.internal'].includes(config.host)) {
    throw new Error('Operacao destrutiva bloqueada: destino nao local.')
  }
  if (Number(config.port) !== LOCAL_DB.port) throw new Error('Operacao destrutiva bloqueada: porta fora do rehearsal.')
  const serialized = JSON.stringify(config)
  if (serialized.includes(PRODUCTION_PROJECT_REF) || serialized.includes(HOMOLOG_PROJECT_REF)) {
    throw new Error('Operacao destrutiva bloqueada: referencia remota detectada.')
  }
}

export function commandName(base) {
  return process.platform === 'win32' ? `${base}.cmd` : base
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPOSITORY_ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : 'pipe',
    maxBuffer: 100 * 1024 * 1024,
  })
  if (result.error) throw new Error(sanitizeText(result.error.message))
  if (result.status !== 0) {
    const detail = sanitizeText([result.stdout, result.stderr].filter(Boolean).join('\n')).trim()
    throw new Error(detail ? `Comando falhou: ${detail}` : `Comando falhou com exit code ${result.status}.`)
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

export function runSupabase(args) {
  const cliEntry = path.join(REPOSITORY_ROOT, 'node_modules', 'supabase', 'dist', 'supabase.js')
  if (!fs.existsSync(cliEntry)) throw new Error('Supabase CLI local nao encontrado. Execute npm ci.')
  return run(process.execPath, [cliEntry, ...args, '--workdir', REHEARSAL_ROOT], { capture: true })
}

function dockerPgEnvironment(config, readOnly = false) {
  const dockerHost = ['127.0.0.1', 'localhost'].includes(config.host)
    ? 'host.docker.internal'
    : config.host
  return {
    ...process.env,
    PGHOST: dockerHost,
    PGPORT: String(config.port || 5432),
    PGUSER: config.user,
    PGPASSWORD: config.password,
    PGDATABASE: config.database || 'postgres',
    PGSSLMODE: config.ssl ? 'require' : 'disable',
    PGOPTIONS: readOnly
      ? '-c default_transaction_read_only=on -c statement_timeout=120000'
      : '-c statement_timeout=300000',
  }
}

export function remoteConnectionConfig(parsed) {
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//u, '') || 'postgres',
    ssl: true,
  }
}

export function runPgTool(tool, args, { connection, outputDirectory, readOnly = false } = {}) {
  const mountArgs = outputDirectory
    ? ['--volume', `${path.resolve(outputDirectory)}:/output`]
    : []
  const envNames = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE', 'PGOPTIONS']
  const envArgs = envNames.flatMap((name) => ['--env', name])
  return run('docker', ['run', '--rm', ...envArgs, ...mountArgs, POSTGRES_IMAGE, tool, ...args], {
    env: dockerPgEnvironment(connection, readOnly),
    capture: true,
  })
}

export async function withPgClient(config, callback, { readOnly = false } = {}) {
  const client = new Client({
    ...config,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    options: readOnly ? '-c statement_timeout=120000' : '-c statement_timeout=300000',
  })
  let readOnlyTransaction = false
  try {
    await client.connect()
    if (readOnly) {
      await client.query('begin transaction read only')
      readOnlyTransaction = true
      const check = await client.query('show transaction_read_only')
      if (check.rows[0]?.transaction_read_only !== 'on') throw new Error('A conexao remota nao entrou em modo read-only.')
    }
    return await callback(client)
  } finally {
    if (readOnlyTransaction) await client.query('rollback').catch(() => undefined)
    await client.end().catch(() => undefined)
  }
}

export function localPgConfig() {
  assertLocalTarget()
  return { ...LOCAL_DB, ssl: false }
}

export function sqlLiteral(value, type = 'text') {
  if (value === null || value === undefined) return 'null'
  if (type === 'boolean') return value ? 'true' : 'false'
  if (type === 'number') return String(value)
  if (type === 'text_array') {
    if (!Array.isArray(value)) throw new Error('Valor de array SQL invalido.')
    return `array[${value.map((item) => sqlLiteral(item)).join(', ')}]::text[]`
  }
  const serialized = type === 'jsonb' && typeof value !== 'string'
    ? JSON.stringify(value)
    : type === 'timestamptz' && value instanceof Date
      ? value.toISOString()
      : String(value)
  const escaped = serialized.replaceAll("'", "''")
  if (type === 'jsonb') return `'${escaped}'::jsonb`
  if (type === 'uuid') return `'${escaped}'::uuid`
  if (type === 'timestamptz') return `'${escaped}'::timestamptz`
  return `'${escaped}'`
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath))
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export function writeSensitiveFile(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 })
}

export function formatError(error) {
  return sanitizeText(error instanceof Error ? error.message : String(error))
}
