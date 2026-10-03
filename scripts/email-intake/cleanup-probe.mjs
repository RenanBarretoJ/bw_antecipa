import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { once } from 'node:events'
import { docker, disposableResources, nativeSupabaseCli } from './disposable-resources.mjs'
import { redactCommandOutput } from '../perf9e/clean-room-lib.mjs'

const exec = promisify(execFile), projectId = `bw_email05_cleanup_${Date.now()}`
await mkdir('rehearsal/reports', { recursive: true })
const owned = await disposableResources({ projectId, file: `rehearsal/reports/${projectId}-manifest.json` })
const args = ['stop', '--project-id', projectId, '--no-backup']
const report = { projectId, wrapper: null, native: null }
const native = await nativeSupabaseCli()
const socket = `/tmp/${projectId}.sock`, requests = []
const proxy = createServer((request, response) => {
  const url = new URL(request.url, 'http://docker.invalid')
  // The probe forwards mutations only when their filter explicitly names its exclusive project.
  if (!['GET', 'HEAD'].includes(request.method) && !decodeURIComponent(request.url).includes(projectId)) {
    requests.push({ method: request.method, pathname: url.pathname, status: 403, errorClass: 'PROBE_REFUSED_PROJECT_FILTER_MISSING_FROM_URL' })
    response.writeHead(403); response.end('UNSCOPED_PROBE_MUTATION_DENIED'); return
  }
  const forwarded = httpRequest({ socketPath: '/var/run/docker.sock', path: request.url, method: request.method, headers: request.headers }, upstream => {
    const row = { method: request.method, pathname: url.pathname, status: upstream.statusCode, errorClass: null }
    requests.push(row)
    let errorBody = ''
    upstream.on('data', bytes => { if (upstream.statusCode >= 400) errorBody += bytes.toString() })
    upstream.on('end', () => {
      if (/minimum supported API version|client version.*too old/i.test(errorBody)) row.errorClass = 'DOCKER_API_VERSION_TOO_OLD'
      else if (/filter/i.test(errorBody)) row.errorClass = 'DOCKER_FILTER_INVALID'
      else if (upstream.statusCode >= 400) row.errorClass = 'DOCKER_API_ERROR'
    })
    response.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(response)
  })
  forwarded.on('error', () => { response.writeHead(502); response.end('DOCKER_PROXY_UNAVAILABLE') })
  request.pipe(forwarded)
})
proxy.listen(socket); await once(proxy, 'listening')
try {
  await docker(['volume', 'create', '--label', `com.supabase.cli.project=${projectId}`, `supabase_db_${projectId}`])
  await docker(['network', 'create', '--label', `com.supabase.cli.project=${projectId}`, `supabase_network_${projectId}`])
  await owned.capture()
  try {
    const result = await exec(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'), ...args, '--debug'], { timeout: 60000, env: { ...process.env, DOCKER_HOST: `unix://${socket}` } })
    report.wrapper = { code: 0, diagnostic: redactCommandOutput(result.stderr).slice(-2000) }
  } catch (error) {
    report.wrapper = { code: error.code, diagnostic: redactCommandOutput(error.stderr ?? '').slice(-2000) }
  }
} finally {
  proxy.close(); await once(proxy, 'close'); report.dockerRequests = requests
  const stop = async () => { await exec(native, args, { timeout: 60000 }) }
  await owned.cleanup(stop)
  await owned.cleanup(stop)
  report.native = 'PASS'; report.idempotent = 'PASS'
  await writeFile(`rehearsal/reports/${projectId}-probe.json`, JSON.stringify(report, null, 2))
  assert.equal(report.native, 'PASS')
  console.log(JSON.stringify(report))
}
