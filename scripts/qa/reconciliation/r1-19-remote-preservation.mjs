import assert from 'node:assert/strict'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { gitBytes } from './r1-5-migration-source.mjs'
import { hash } from './r1-4-restorer.mjs'
import { inventory } from '../../email-intake/disposable-resources.mjs'

const checkpoint = 'rehearsal/reports/R1_19_REMOTE_CHECKPOINT.json'
export const sourceFiles = () => [...new Set(gitBytes(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean))].sort()
async function reports(dir = 'rehearsal/reports') {
  const files = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = dir + '/' + e.name
    if (e.isDirectory()) files.push(...await reports(path))
    else if (e.isFile()) files.push({ path, sha256: hash(await readFile(path)) })
  }
  return files
}
export async function verifyPreservation() {
  const before = JSON.parse(await readFile(checkpoint, 'utf8')), changed = []
  assert.equal(gitBytes(['rev-parse', 'HEAD']).toString().trim(), before.head)
  assert.equal(gitBytes(['diff', '--cached', '--binary']).toString(), before.indexDiff)
  for (const f of [...before.source, ...before.reports]) {
    const actual = hash(await readFile(f.path))
    if (actual !== f.sha256) {
      assert(['vercel.json', '.github/workflows/ci.yml', '.github/workflows/reconciliation-certification.yml'].includes(f.path), 'OUT_OF_SCOPE_CHANGE:' + f.path)
      changed.push({ path: f.path, before: f.sha256, after: actual })
    }
  }
  const added = sourceFiles().filter(f => !before.source.some(x => x.path === f))
  for (const f of added) assert.match(f, /^scripts\/qa\/reconciliation\/r1-19-[a-z-]+(?:\.test)?\.mjs$/, 'UNEXPECTED_NEW_FILE:' + f)
  assert.deepEqual(await inventory(), before.docker)
  return { result: 'PASS', sourceFiles: before.source.length, reports: before.reports.length, changed, added, preexistingDocker: 'PRESERVED', historicalEvidence: 'BYTE_IDENTICAL' }
}
if (process.argv[2] === '--capture') {
  assert.deepEqual(process.argv.slice(2), ['--capture'])
  assert.equal(gitBytes(['branch', '--show-current']).toString().trim(), 'reconcile/main-homolog-2026-10-06')
  const source = []
  for (const path of sourceFiles()) source.push({ path, sha256: hash(await readFile(path)) })
  const record = { at: new Date().toISOString(), head: gitBytes(['rev-parse', 'HEAD']).toString().trim(), status: gitBytes(['status', '--short']).toString(), indexDiff: gitBytes(['diff', '--cached', '--binary']).toString(), source, reports: await reports(), docker: await inventory() }
  await writeFile(checkpoint, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ result: 'PASS', files: source.length, reports: record.reports.length }))
}
