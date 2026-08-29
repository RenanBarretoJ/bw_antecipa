import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const CLEAN_ROOM_CONFIRMATION = 'DISPOSABLE_LOCAL_ONLY'

export function assertCleanRoomArguments(args) {
  if (args.confirm !== CLEAN_ROOM_CONFIRMATION) {
    throw new Error(`Confirme o alvo descartavel local com --confirm ${CLEAN_ROOM_CONFIRMATION}.`)
  }

  const forbidden = ['db-url', 'env-file', 'linked', 'remote', 'prod', 'production', 'homolog', 'project-ref']
  const received = forbidden.filter((key) => args[key] !== undefined)
  if (received.length) {
    throw new Error(`Clean-room recusa argumentos remotos ou de ambiente: ${received.join(', ')}.`)
  }

  if (args.cycles !== undefined && Number(args.cycles) !== 2) {
    throw new Error('O Escopo 9E exige exatamente dois ciclos independentes.')
  }
}

export function sanitizedLocalEnvironment(source = process.env) {
  const environment = { ...source }
  const sensitiveOrRemote = /^(DATABASE_URL|DIRECT_URL|POSTGRES_URL|SUPABASE_DB_URL|SUPABASE_ACCESS_TOKEN|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_PROJECT_REF|APP_ENV|VERCEL_ENV)$/i
  for (const key of Object.keys(environment)) {
    if (sensitiveOrRemote.test(key)) delete environment[key]
  }
  environment.SUPABASE_INTERNAL_IMAGE_REGISTRY = environment.SUPABASE_INTERNAL_IMAGE_REGISTRY ?? ''
  return environment
}

export function configureDisposableToml(source, { projectId, apiPort, dbPort, shadowPort, studioPort, mailPort, analyticsPort }) {
  let config = source
    .replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`)
    .replace(/(\[api\][\s\S]*?^port\s*=\s*)\d+/m, `$1${apiPort}`)
    .replace(/(\[db\][\s\S]*?^port\s*=\s*)\d+/m, `$1${dbPort}`)
    .replace(/(\[db\][\s\S]*?^shadow_port\s*=\s*)\d+/m, `$1${shadowPort}`)
    .replace(/(\[studio\][\s\S]*?^port\s*=\s*)\d+/m, `$1${studioPort}`)
    .replace(/(\[inbucket\][\s\S]*?^port\s*=\s*)\d+/m, `$1${mailPort}`)
    .replace(/(\[analytics\][\s\S]*?^port\s*=\s*)\d+/m, `$1${analyticsPort}`)
  config = config.replace(/(\[db\.seed\][\s\S]*?^enabled\s*=\s*)true/m, '$1false')
  config = config.replace(/(\[db\.seed\][\s\S]*?^sql_paths\s*=\s*)\[[^\]]*\]/m, '$1[]')
  return config
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function fileSha256(path) {
  return sha256(readFileSync(path))
}

export function redactCommandOutput(value = '') {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[LOCAL_DATABASE_URL_REDACTED]')
    .replace(/(?:service_role|anon)_key\s*[:=]\s*[^\s'"<>]+/gi, '[LOCAL_KEY_REDACTED]')
    .replace(/eyJ[A-Za-z0-9_.-]{30,}/g, '[JWT_REDACTED]')
}

export function normalizeCatalogValue(value) {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map(normalizeCatalogValue)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalizeCatalogValue(item)]))
  }
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').replaceAll('"', '').trim()
    : value
}

export function stableCatalogRows(rows) {
  return rows.map(normalizeCatalogValue).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}
