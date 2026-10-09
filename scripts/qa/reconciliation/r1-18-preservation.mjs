import assert from 'node:assert/strict'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { inventory } from '../../email-intake/disposable-resources.mjs'
import { hash } from './r1-4-restorer.mjs'
import { gitBytes } from './r1-5-migration-source.mjs'

const checkpointPath = 'rehearsal/reports/R1_18_CHECKPOINT.json'
export async function verifyPreservation(allowedQa = []) {
  const cp = JSON.parse(await readFile(checkpointPath, 'utf8')), changed = []
  for (const f of [...cp.files, ...cp.reports]) {
    const current = hash(await readFile(f.path))
    if (current !== f.sha256) {
      if (f.path === 'src/types/database.ts') {
        // R1.18 section 22: only the proven target constraint union may change.
        const text = await readFile(f.path, 'utf8')
        const target = "origem: 'perfil_primario' | 'bootstrap_homolog' | 'bootstrap_producao' | 'administracao'"
        const original = "origem: 'perfil_primario' | 'bootstrap_homolog' | 'administracao'"
        assert.equal(text.split(target).length, 2)
        // apply_patch emits LF for the edited line; the checkpoint used CRLF.
        // Reconstruct those exact original bytes, without accepting other edits.
        assert.equal(hash(Buffer.from(text.replace(target, original).replace(/\r?\n/g, '\r\n'))), f.sha256, 'TYPE_CHANGE_BEYOND_APPROVED_ORIGIN_UNION')
      } else assert(allowedQa.includes(f.path) && f.path.startsWith('scripts/qa/reconciliation/'), 'UNAUTHORIZED_CHANGE:' + f.path)
      changed.push({ path: f.path, before: f.sha256, after: current })
    }
  }
  assert.equal(gitBytes(['rev-parse', 'HEAD']).toString().trim(), cp.head)
  assert.deepEqual(await inventory(), cp.docker)
  return { result: 'PASS', files: cp.files.length, reports: cp.reports.length, changedQa: changed, docker: 'PREEXISTING_PRESERVED' }
}
if (process.argv.includes('--checkpoint')) {
  assert.deepEqual(process.argv.slice(2), ['--checkpoint', '--local-only'])
  assert.equal(gitBytes(['branch', '--show-current']).toString().trim(), 'reconcile/main-homolog-2026-10-06')
  const prior = JSON.parse(await readFile('rehearsal/reports/R1_17_CHECKPOINT.json', 'utf8'))
  for (const f of [...prior.files, ...prior.reports]) assert.equal(hash(await readFile(f.path)), f.sha256, 'R117_ARTIFACT_CHANGED:' + f.path)
  const cp = { at: new Date().toISOString(), head: gitBytes(['rev-parse', 'HEAD']).toString().trim(), status: gitBytes(['status', '--short']).toString(), files: [], reports: [], docker: await inventory() }
  assert.equal(cp.head, '2e8146ebe7582c5bdc10ddee1f8862d806607ee2')
  for (const path of [...new Set(gitBytes(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean))].sort()) cp.files.push({ path, sha256: hash(await readFile(path)) })
  async function scan(dir) { for (const e of await readdir(dir, { withFileTypes: true })) { const path = dir + '/' + e.name; if (e.isDirectory()) await scan(path); else cp.reports.push({ path, sha256: hash(await readFile(path)) }) } }
  await scan('rehearsal/reports')
  for (const name of ['R1_16_FORWARD_MANIFEST', 'R1_16_AUTH_FORWARD_MANIFEST']) {
    const m = JSON.parse(await readFile(`rehearsal/reports/${name}.json`, 'utf8'))
    for (const f of m.entries ?? [m.entry]) assert.equal(hash(await readFile(f.path)), f.sha256)
  }
  await writeFile(checkpointPath, JSON.stringify(cp, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ result: 'PASS', files: cp.files.length, reports: cp.reports.length }))
}
