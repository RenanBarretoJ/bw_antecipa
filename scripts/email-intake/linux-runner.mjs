import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, cp, readdir, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { docker, disposableResources, resumeDisposableResources, nativeSupabaseCli } from './disposable-resources.mjs'
import { redactCommandOutput } from '../perf9e/clean-room-lib.mjs'
import { archiveRunnerEvidence, verifyArchivedEvidence, evidenceReportName } from './runner-evidence.mjs'

const exec = promisify(execFile)
const mode = process.argv[2] ?? '--full'
assert.ok(['--probe', '--diagnostic', '--browser', '--full'].includes(mode), 'UNKNOWN_LINUX_RUNNER_MODE')
const projectId = `bw_email05_runner_${Date.now()}`, runner = `supabase_runner_${projectId}`
const root = resolve('rehearsal/tmp', projectId), reports = resolve('rehearsal/reports', projectId)
await mkdir(reports, { recursive: true })
const owned = await disposableResources({ projectId, file: resolve(reports, 'runner-manifest.json'), tempDirs: [root], runnerId: runner })
let interrupted = false, active, rejectInterruption
const interruptedPromise = new Promise((_, reject) => { rejectInterruption = reject })
// Prevent unhandled rejections before Promise.race is installed.
interruptedPromise.catch(() => {})
const signal = () => { interrupted = true; active?.kill('SIGTERM'); rejectInterruption(Error('LINUX_RUNNER_INTERRUPTED')) }
process.once('SIGINT', signal); process.once('SIGTERM', signal)
const run = args => new Promise((done, reject) => {
  active = spawn('docker', ['exec', runner, ...args], { windowsHide: true })
  let output = ''
  for (const stream of [active.stdout, active.stderr]) stream.on('data', bytes => { output += bytes.toString() })
  active.on('error', reject)
  active.on('exit', code => { active = null; process.stdout.write(redactCommandOutput(output)); if (code === 0) done(); else reject(Error(`LINUX_COMMAND_FAILED:${code}`)) })
})
let timer
const requiredArtifacts = new Set(['reports/runner-manifest.json'])
try {
  try { await docker(['image', 'inspect', 'bw-email05-r3-linux-qa', '--format', '{{.Id}}']) }
  catch { await exec('docker', ['build', '-t', 'bw-email05-r3-linux-qa', '-f', 'scripts/email-intake/linux-runner.Dockerfile', 'scripts/email-intake'], { windowsHide: true, timeout: 600000, maxBuffer: 4 * 1024 * 1024 }) }
  await exec('git', ['clone', '--quiet', '--no-hardlinks', '--single-branch', '--branch', 'feature/rlx-email05-operations', '.', root], { windowsHide: true })
  const { stdout } = await exec('git', ['ls-files', '--modified', '--others', '--exclude-standard', '-z'], { windowsHide: true })
  for (const file of stdout.split('\0').filter(Boolean)) {
    assert.match(file, /^(scripts|src|docs|\.github)\//, 'UNEXPECTED_WORKTREE_FILE')
    assert.ok(!file.split('/').includes('..'))
    await mkdir(resolve(root, file, '..'), { recursive: true })
    await cp(resolve(file), resolve(root, file))
  }
  const mount = process.platform === 'win32' ? `/run/desktop/mnt/host/${root[0].toLowerCase()}${root.slice(2).replaceAll('\\', '/')}` : root
  const label = `com.supabase.cli.project=${projectId}`
  const sourceVolume = `supabase_source_${projectId}`
  await mkdir(resolve(root, 'rehearsal'), { recursive: true })
  await docker(['volume', 'create', '--label', label, sourceVolume])
  await owned.capture()
  await docker(['run', '-d', '--init', '--name', runner, '--label', label, '--network', 'host', '--group-add', '0', '--cap-add', 'SYS_ADMIN',
    '-v', '/var/run/docker.sock:/var/run/docker.sock', '-v', `${root}:/input:ro`, '-v', `${sourceVolume}:${mount}`, '-v', `${resolve(root, 'rehearsal')}:${mount}/rehearsal`,
    '-w', mount, 'bw-email05-r3-linux-qa', 'sleep', 'infinity'])
  await owned.capture()
  await docker(['exec', '-u', 'root', runner, 'chown', 'node:node', mount])
  await run(['node', '--input-type=module', '-e', "import {readdir,cp} from 'node:fs/promises';for(const entry of await readdir('/input'))if(entry!=='rehearsal')await cp('/input/'+entry,process.argv[1]+'/'+entry,{recursive:true});", mount])
  await run(['git', 'config', '--global', '--add', 'safe.directory', mount])
  await run(['git', 'config', 'core.autocrlf', 'true'])
  await run(['git', 'config', 'core.filemode', 'false'])
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { interrupted = true; reject(Error('LINUX_RUNNER_TIMEOUT')) }, 40 * 60 * 1000) })
  const task = async () => {
    await run(['npm', 'ci', '--no-audit', '--no-fund'])
    if (interrupted) throw Error('LINUX_RUNNER_INTERRUPTED')
    if (mode === '--diagnostic') {
      await run(['node', '--test', 'scripts/email-intake/browser-diagnostics.test.mjs', 'scripts/email-intake/browser-redaction.test.mjs', 'scripts/email-intake/browser-protocol.test.mjs', 'scripts/email-intake/browser-drain.test.mjs', 'scripts/email-intake/browser-finalization.test.mjs', 'scripts/email-intake/browser-no-body.test.mjs', 'scripts/email-intake/browser-signed-url.test.mjs', 'scripts/email-intake/fiscal-signed-url-policy.test.mjs', 'scripts/email-intake/disposable-resources.test.mjs', 'scripts/email-intake/runner-evidence.test.mjs'])
      requiredArtifacts.add('reports/email05-r3-redaction-probe.json')
      await run(['node', 'scripts/email-intake/redaction-probe.mjs'])
      requiredArtifacts.add('reports/email05-r8-no-body-probe.json')
      await run(['node', 'scripts/email-intake/no-body-probe.mjs'])
      requiredArtifacts.add('reports/email05-r10-finalization-probe.json')
      await run(['node', 'scripts/email-intake/finalization-probe.mjs'])
    }
    const script = ['--probe', '--diagnostic'].includes(mode) ? 'cleanup-probe.mjs' : mode === '--full' ? 'linux-certify.mjs' : 'clean-room.mjs'
    if (mode === '--full') { requiredArtifacts.add('reports/email05-r10-finalization-probe.json'); requiredArtifacts.add('reports/email05-r3-linux.json'); requiredArtifacts.add('reports/email05-r8-no-body-probe.json') }
    if (mode === '--browser') requiredArtifacts.add('reports/RLX_EMAIL_03_CLEAN_ROOM.json')
    await run(['node', `scripts/email-intake/${script}`, ...(mode === '--browser' ? ['--storage-api', '--automation', '--operators'] : [])])
  }
  await Promise.race([task(), timeout, interruptedPromise])
} finally {
  clearTimeout(timer)
  if (interrupted) await docker(['kill', runner]).catch(() => {})
  // Recover an interrupted child's manifest before removing the runner recorded in its baseline.
  try {
    const childReports = resolve(root, 'rehearsal/reports')
    for (const name of await readdir(childReports).catch(() => [])) {
      if (!name.endsWith('-resources.json')) continue
      const child = await resumeDisposableResources(resolve(childReports, name))
      assert.match(child.manifest.projectId, /^bw_email03_\d+$/)
      const native = await nativeSupabaseCli()
      await child.cleanup(async () => { await exec(native, ['stop', '--project-id', child.manifest.projectId, '--no-backup'], { windowsHide: true, timeout: 60000 }) })
    }
  } finally {
    let archived = false, removed = false, persistenceVerified = false
    try {
      await owned.cleanup(async () => {})
      await owned.cleanup(async () => {})
    }
    finally {
      try {
        const childReports = resolve(root, 'rehearsal/reports')
        await mkdir(childReports, { recursive: true })
        await cp(resolve(reports, 'runner-manifest.json'), resolve(childReports, 'runner-manifest.json'))
        for (const name of await readdir(childReports)) if (evidenceReportName(name)) {
          requiredArtifacts.add(`reports/${name}`)
          if (/^bw_email05_cleanup_\d+-manifest\.json$/.test(name)) requiredArtifacts.add(`reports/${name.replace('-manifest.json', '-probe.json')}`)
        }
        const evidence = resolve(reports, 'evidence')
        await archiveRunnerEvidence(root, evidence, { requiredArtifacts: [...requiredArtifacts], requireOperatorArtifacts: ['--full', '--browser'].includes(mode) })
        archived = true
        // Resolved disposable clone only; verified reports live outside this directory.
        assert.ok(root.startsWith(resolve('rehearsal/tmp') + sep + 'bw_email05_runner_'))
        await rm(root, { recursive: true, force: true }); removed = true
        await verifyArchivedEvidence(evidence); persistenceVerified = true
      } finally {
        process.off('SIGINT', signal); process.off('SIGTERM', signal)
        const cleanupPassed = owned.manifest.cleanupRuns.length >= 2 && owned.manifest.cleanupRuns.every(run => run.result === 'PASS')
        console.log(JSON.stringify({ projectId, dockerCleanup: cleanupPassed ? 'PASS' : 'FAIL', cleanupIdempotent: cleanupPassed ? 'PASS' : 'FAIL',
          evidencePreserved: archived && persistenceVerified, tempDirRemoved: removed, evidenceRealPersistence: persistenceVerified ? 'PASS' : 'FAIL', evidence: reports }))
      }
    }
  }
}
