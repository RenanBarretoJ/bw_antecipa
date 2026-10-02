import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { redactCommandOutput } from '../perf9e/clean-room-lib.mjs'

/** One deployable build per disposable run, shared by the fiscal and operator browser tests. */
export async function prepareEmailBrowserRuntime(environment, root) {
  assert.equal(environment.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57841')
  assert.ok(root.startsWith(resolve('rehearsal/tmp', 'bw_email03_')))
  const source = execFileSync('git', ['diff', 'HEAD', '--', 'src', 'next.config.ts', 'package.json', 'package-lock.json'], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 })
  const fingerprint = createHash('sha256').update(source).update(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY).digest('hex')
  const marker = resolve(root, 'email-browser-build.json')
  const cached = JSON.parse(await readFile(marker, 'utf8').catch(() => 'null'))
  const currentId = await readFile('.next/BUILD_ID', 'utf8').catch(() => null)
  if (cached?.fingerprint === fingerprint && cached.buildId === currentId) return
  const build = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'build', '--webpack'], {
    windowsHide: true, env: { ...environment, NODE_ENV: 'production' }, encoding: 'utf8', timeout: 360000, maxBuffer: 10 * 1024 * 1024,
  })
  await writeFile(resolve(root, 'email-browser-build.log'), redactCommandOutput(`${build.stdout ?? ''}\n${build.stderr ?? ''}`))
  assert.equal(build.status, 0, 'EMAIL_BROWSER_BUILD_FAILED')
  await writeFile(marker, JSON.stringify({ fingerprint, buildId: await readFile('.next/BUILD_ID', 'utf8'), result: 'PASS' }))
}
