import { spawn } from 'node:child_process'

// Observe transport only. Callers retain their original exit-zero assertions,
// timeout budgets and SIGTERM behavior; arguments, input and env are not logged.
export function observeTransport(program, args, input, timeoutMs = 120000, options = {}, runtime = {}) {
  const { phase = 'PREFLIGHT', sanitize = String, env, ignoreInput = false } = options
  const startProcess = runtime.spawn ?? spawn, now = runtime.now ?? Date.now
  const schedule = runtime.setTimeout ?? setTimeout, cancel = runtime.clearTimeout ?? clearTimeout
  const started = now()
  return new Promise((done, reject) => {
    let child, timer, settled = false, timedOut = false
    const out = [], err = []
    const finish = (status, signal, nativeError = null) => {
      if (settled) return
      settled = true
      if (timer !== undefined) cancel(timer)
      const transport = { event: 'QA_TRANSPORT_EXIT', program, phase, elapsedMs: now() - started,
        timeoutMs, timeoutKind: timedOut ? 'TRANSPORT_TIMEOUT' : nativeError?.code === 'ETIMEDOUT' ? 'SPAWN_TIMEOUT' : null,
        status: status ?? null, signal: signal ?? null, errorCode: nativeError?.code ?? null,
        nativeError: nativeError ? { name: nativeError.name, message: sanitize(nativeError.message) } : null }
      if (nativeError) {
        const error = new Error(`${sanitize(nativeError.message)} ${JSON.stringify(transport)}`)
        error.code = nativeError.code
        error.transport = transport
        reject(error)
      } else done({ stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), status, transport })
    }
    try {
      child = startProcess(program, args, { windowsHide: true,
        stdio: [ignoreInput ? 'ignore' : 'pipe', 'pipe', 'pipe'], ...(env ? { env } : {}) })
    } catch (error) { finish(null, null, error); return }
    timer = schedule(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
    child.stdout.on('data', bytes => out.push(bytes)); child.stderr.on('data', bytes => err.push(bytes))
    child.on('error', error => finish(null, null, error))
    child.on('close', (status, signal) => finish(status, signal))
    if (!ignoreInput) {
      child.stdin.on('error', () => {})
      child.stdin.end(input)
    }
  })
}
