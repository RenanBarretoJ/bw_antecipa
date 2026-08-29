import fs from 'node:fs'
import path from 'node:path'
import {
  REPORT_DIR,
  REPOSITORY_ROOT,
  ensureRuntimeDirectories,
  fileSha256,
  formatError,
  sha256,
  stableJson,
  writeJson,
} from './lib.mjs'
import { validateProductionManifest } from './production-manifest.mjs'

const ROOTS = ['src', 'supabase/migrations', 'rehearsal/scripts', 'rehearsal/manifests']
const FILES = ['package.json', 'package-lock.json', 'next.config.ts']

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? collectFiles(absolute) : [absolute]
  })
}

try {
  ensureRuntimeDirectories()
  const manifest = validateProductionManifest()
  const absoluteFiles = [
    ...ROOTS.flatMap((root) => collectFiles(path.join(REPOSITORY_ROOT, root))),
    ...FILES.map((file) => path.join(REPOSITORY_ROOT, file)),
  ].sort((left, right) => left.localeCompare(right, 'en'))
  const entries = absoluteFiles.map((absolute) => ({
    file: path.relative(REPOSITORY_ROOT, absolute).replaceAll('\\', '/'),
    sha256: fileSha256(absolute),
  }))
  const releaseHash = sha256(stableJson({ manifest_hash: manifest.manifest_hash, entries }))
  writeJson(path.join(REPORT_DIR, 'P3_RELEASE_HASH.json'), {
    generated_at: new Date().toISOString(),
    scope: ROOTS,
    files: entries.length,
    production_manifest_hash: manifest.manifest_hash,
    release_candidate_hash: releaseHash,
  })
  console.log(`RELEASE_CANDIDATE_HASH = ${releaseHash}`)
  console.log(`Arquivos cobertos: ${entries.length}`)
} catch (error) {
  console.error(`Hash do release candidate falhou: ${formatError(error)}`)
  process.exitCode = 1
}
