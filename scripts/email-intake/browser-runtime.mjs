import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFile, writeFile, appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { redactCommandOutput } from '../perf9e/clean-room-lib.mjs'

/** One deployable build per disposable run, shared by the fiscal and operator browser tests. */
export async function prepareEmailBrowserRuntime(environment, root) {
  assert.equal(environment.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57841')
  assert.ok(root.startsWith(resolve('rehearsal/tmp', 'bw_email03_')))
  // Hash build inputs, not a textual Git diff whose index/line-ending representation can change.
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src', 'next.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json'],
    { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 }).split('\0').filter(Boolean)
  const source = createHash('sha256')
  for (const path of [...new Set(paths)].sort()) source.update(path).update('\0').update(await readFile(path).catch(error => { if (error.code === 'ENOENT') return '[DELETED]'; throw error }))
  const sourceHash = source.digest('hex')
  const fingerprint = createHash('sha256').update(sourceHash).update(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY).digest('hex')
  const marker = resolve(root, 'email-browser-build.json')
  const cached = JSON.parse(await readFile(marker, 'utf8').catch(() => 'null'))
  const currentId = await readFile('.next/BUILD_ID', 'utf8').catch(() => null)
  await appendFile(resolve(root, 'email-browser-build-attempts.jsonl'), JSON.stringify({
    sourceHash, publicConfigHash: createHash('sha256').update(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY).digest('hex'),
    fingerprint, cachedFingerprint: cached?.fingerprint ?? null, matchingBuildId: cached?.buildId === currentId, nodeEnv: environment.NODE_ENV ?? null,
  }) + '\n')
  if (cached?.fingerprint === fingerprint && cached.buildId === currentId) return
  const build = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'], {
    windowsHide: true, env: { ...environment, NODE_ENV: 'production' }, encoding: 'utf8', timeout: 360000, maxBuffer: 10 * 1024 * 1024,
  })
  await writeFile(resolve(root, 'email-browser-build.log'), redactCommandOutput(`${build.stdout ?? ''}\n${build.stderr ?? ''}`))
  assert.equal(build.status, 0, 'EMAIL_BROWSER_BUILD_FAILED')
  await writeFile(marker, JSON.stringify({ fingerprint, buildId: await readFile('.next/BUILD_ID', 'utf8'), result: 'PASS' }))
}
