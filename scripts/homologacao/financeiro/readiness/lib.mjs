import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export const READINESS_SCHEMA = 'bw-antecipa-p2-6-1-readiness-v1'

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function buildMigrationInventory(root = process.cwd()) {
  const directory = resolve(root, 'supabase/migrations')
  const migrations = readdirSync(directory)
    .filter((filename) => filename.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))
    .map((filename, index) => {
      const content = readFileSync(resolve(directory, filename))
      const match = filename.match(/^(\d+)_([^.]*)\.sql$/)
      if (!match) throw new Error(`Nome de migration invalido: ${filename}`)
      return {
        ordem: index + 1,
        filename,
        timestamp: match[1],
        nome: match[2],
        bytes: content.byteLength,
        sha256: sha256(content),
      }
    })
  return {
    schema: READINESS_SCHEMA,
    total: migrations.length,
    first: migrations[0]?.filename ?? null,
    last: migrations.at(-1)?.filename ?? null,
    manifest_sha256: sha256(migrations.map((item) => `${item.ordem}|${item.filename}|${item.sha256}`).join('\n')),
    migrations,
  }
}

export function compareMigrationHistory(inventory, remoteRows) {
  const localByVersion = new Map(inventory.migrations.map((item) => [item.timestamp, item]))
  const remoteByVersion = new Map(remoteRows.map((item) => [String(item.version), item]))
  const missingRemote = inventory.migrations.filter((item) => !remoteByVersion.has(item.timestamp))
  const extraRemote = remoteRows.filter((item) => !localByVersion.has(String(item.version)))
  const nameMismatches = remoteRows.flatMap((item) => {
    const local = localByVersion.get(String(item.version))
    if (!local || !item.name || item.name === local.nome) return []
    return [{ version: String(item.version), local: local.nome, remote: String(item.name) }]
  })
  return {
    local_total: inventory.total,
    remote_total: remoteRows.length,
    missing_remote: missingRemote.map(({ timestamp, filename, sha256: checksum }) => ({ version: timestamp, filename, sha256: checksum })),
    extra_remote: extraRemote.map(({ version, name }) => ({ version: String(version), name: name ?? null })),
    name_mismatches: nameMismatches,
    aligned: missingRemote.length === 0 && extraRemote.length === 0 && nameMismatches.length === 0,
  }
}

export function walkFiles(directory, predicate = () => true) {
  const files = []
  for (const entry of readdirSync(directory)) {
    if (['.git', '.next', 'node_modules'].includes(entry)) continue
    const path = join(directory, entry)
    const stats = statSync(path)
    if (stats.isDirectory()) files.push(...walkFiles(path, predicate))
    else if (predicate(path)) files.push(path)
  }
  return files.sort()
}

export function scanActiveStructuralRlx(root = process.cwd()) {
  const sourceRoot = resolve(root, 'src')
  const matches = []
  for (const path of walkFiles(sourceRoot, (item) => /\.(?:ts|tsx|js|mjs)$/.test(item) && !/[.]test[.]/.test(item))) {
    const content = readFileSync(path, 'utf8')
    for (const match of content.matchAll(/public[.]rlx_[a-z0-9_]+/gi)) {
      matches.push({ file: relative(root, path).replaceAll('\\', '/'), token: match[0], offset: match.index })
    }
  }
  return matches
}

export function check(id, categoria, passed, evidencia, options = {}) {
  return {
    check_id: id,
    categoria,
    status: passed ? 'PASS' : (options.pending ? 'PENDENTE' : 'FAIL'),
    evidencia,
    blocker: passed ? false : options.blocker !== false,
    observacao: options.observacao ?? null,
  }
}

export function sanitizeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[DATABASE_URL_REDACTED]')
    .replace(/eyJ[A-Za-z0-9_.-]{30,}/g, '[JWT_REDACTED]')
    .replace(/[A-Za-z0-9_-]{48,}/g, '[SECRET_REDACTED]')
}
