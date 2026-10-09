import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'

export const PDF_PUBLIC_ERROR = 'Não foi possível gerar o documento. Tente novamente em instantes.'

type DocumentType = 'contrato_mae' | 'termo_cessao' | 'notificacao_sacado' | 'termo_quitacao' | 'pdf'
type Stage = 'RESOLVE_CHROMIUM' | 'LAUNCH' | 'UPLOAD' | 'REGISTER' | 'BROWSER_CLOSE' | 'RENDER' | 'REQUEST'
type Event = `PDF_${Stage}_${'START' | 'SUCCESS' | 'ERROR'}` | 'PDF_PAGE_CREATED' | 'PDF_CONTENT_SET' | 'PDF_EXECUTABLE_STAT'
type SafeError = {
  name: string
  message: string
  code: string | null
  errno: number | null
  syscall: string | null
  path: string | null
  spawnargs: string[] | null
  stack: string | null
}
type ExecutableStat = {
  exists: boolean | null
  size?: number
  mode?: number
  mtimeMs?: number
  isFile?: boolean
  error?: SafeError
}
export type PdfLogEvent = {
  event: Event
  stage: string
  correlationId: string
  runtimeInstanceId: string
  pid: number
  timestamp: string
  documentType: DocumentType
  operationId?: string
  nodeVersion: string
  platform: string
  arch: string
  region: string | null
  deploymentId: string | null
  commitSha: string | null
  strategy: 'local' | 'sparticuz'
  chromiumBinaryUrlConfigured: boolean
  tmpdir: string | null
  resolutionConcurrency: number
  launchConcurrency: number
  resolvedExecutablePath: string | null
  executableStat: ExecutableStat | null
  durationMs?: number
  error?: SafeError
}
type Sink = (event: PdfLogEvent) => void

const runtimeInstanceId = randomUUID()
let chromiumResolutionInFlight = 0
let chromiumLaunchInFlight = 0

function identifier(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(value) ? value : null
}

function redact(value: string): string {
  let result = value
  // Paths and stack frames must not accidentally retain a configured credential.
  for (const [key, secret] of Object.entries(process.env)) {
    if (secret && secret.length >= 4 && /SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY|SERVICE_ROLE|CHROMIUM_BINARY_URL/i.test(key)) {
      result = result.split(secret).join('[REDACTED]')
    }
  }
  return result
    .replace(/[A-Z]:\\Users\\[^\\]+/gi, 'C:\\Users\\[REDACTED]')
    .replace(/\/(?:home|Users)\/[^/]+/g, '/home/[REDACTED]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[REDACTED]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[REDACTED]')
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED]')
}

function safePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (!/^(?:\/(?!\/)|[A-Za-z]:[\\/])/.test(value) || /[\r\n<>?=#]/.test(value)) return '[REDACTED]'
  return redact(value).slice(0, 512)
}

export function sanitizePdfError(error: unknown): SafeError {
  const fields = typeof error === 'object' && error !== null ? error : {}
  const rawName = 'name' in fields ? fields.name : null
  const name = typeof rawName === 'string' && /^(Error|TypeError|RangeError|ReferenceError|SyntaxError|TimeoutError|ProtocolError|TargetCloseError|AbortError)$/.test(rawName) ? rawName : 'Error'
  const rawCode = 'code' in fields ? fields.code : null
  const code = typeof rawCode === 'string' && /^(E[A-Z0-9_]{2,40}|PGRST\d{3}|\d{5})$/.test(rawCode) ? rawCode : null
  const rawMessage = 'message' in fields && typeof fields.message === 'string' ? fields.message : ''
  // Arbitrary library messages may contain HTML, URLs, SQL or user data.
  const message = /^(?:spawn(?:Sync)? )?E[A-Z0-9_]{2,30}$/.test(rawMessage)
    ? rawMessage : '[REDACTED]'
  const rawStack = 'stack' in fields && typeof fields.stack === 'string' ? fields.stack : null
  const frames = rawStack?.split('\n').slice(1, 16).map((line) => {
    const location = line.match(/^\s+at\s+(?:.*?\()?((?:node:|\/|[A-Za-z]:[\\/])[^\n]*?:\d+:\d+)\)?$/)?.[1]
    if (!location) return '    at [REDACTED]'
    if (/^node:[a-zA-Z0-9_/:.-]+$/.test(location)) return `    at ${location}`
    return `    at ${safePath(location) ?? '[REDACTED]'}`
  })
  const args = 'spawnargs' in fields && Array.isArray(fields.spawnargs) ? fields.spawnargs : null
  return {
    name,
    message,
    code,
    errno: 'errno' in fields && typeof fields.errno === 'number' && Number.isFinite(fields.errno) ? fields.errno : null,
    syscall: 'syscall' in fields && typeof fields.syscall === 'string' && /^(spawn|spawnSync|stat|lstat|open|read|write|access|connect)$/.test(fields.syscall) ? fields.syscall : null,
    path: safePath('path' in fields ? fields.path : null),
    spawnargs: args?.slice(0, 100).map((arg: unknown) => {
      if (typeof arg !== 'string') return '[REDACTED]'
      const flag = arg.match(/^(--[a-z][a-z0-9-]{0,80})(=|$)/)?.[1]
      return flag ? flag + (arg.includes('=') ? '=[REDACTED]' : '') : '[REDACTED]'
    }) ?? null,
    stack: frames ? [`${name}: ${message}`, ...frames].join('\n') : null,
  }
}

const defaultSink: Sink = (event) => {
  const line = JSON.stringify(event)
  if (event.event.endsWith('_ERROR')) console.error('[pdf]', line)
  else console.info('[pdf]', line)
}

export function createPdfTelemetry(documentType: DocumentType, sink: Sink = defaultSink) {
  const correlationId = randomUUID()
  let operationId: string | undefined
  let resolvedExecutablePath: string | null = null
  let executableStat: ExecutableStat | null = null

  function emit(event: Event, extra: { durationMs?: number; error?: SafeError } = {}) {
    try {
      sink({
        event, stage: event.replace(/^PDF_/, '').replace(/_(START|SUCCESS|ERROR)$/, ''),
        correlationId, runtimeInstanceId, pid: process.pid, timestamp: new Date().toISOString(),
        documentType, operationId, nodeVersion: process.version, platform: process.platform, arch: process.arch,
        region: identifier(process.env.VERCEL_REGION), deploymentId: identifier(process.env.VERCEL_DEPLOYMENT_ID),
        commitSha: identifier(process.env.VERCEL_GIT_COMMIT_SHA),
        strategy: process.env.NODE_ENV === 'development' || process.env.CHROME_PATH ? 'local' : 'sparticuz',
        chromiumBinaryUrlConfigured: Boolean(process.env.CHROMIUM_BINARY_URL), tmpdir: safePath(tmpdir()),
        resolutionConcurrency: chromiumResolutionInFlight, launchConcurrency: chromiumLaunchInFlight,
        resolvedExecutablePath, executableStat, ...extra,
      })
    } catch {
      // Telemetry failure must never change document generation or error propagation.
    }
  }

  function failure(event: Event, error: unknown, durationMs?: number) {
    try { emit(event, { error: sanitizePdfError(error), durationMs }) } catch {
      // Even a malformed third-party Error must leave the original failure intact.
    }
  }

  return {
    correlationId,
    setOperationId(value: unknown) {
      if (typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) operationId = value
    },
    emit,
    failure,
    async captureExecutable(executablePath: string) {
      resolvedExecutablePath = safePath(executablePath)
      try {
        const info = await stat(executablePath)
        executableStat = { exists: true, size: info.size, mode: info.mode, mtimeMs: info.mtimeMs, isFile: info.isFile() }
      } catch (error) {
        const safeError = sanitizePdfError(error)
        executableStat = { exists: safeError.code === 'ENOENT' ? false : null, error: safeError }
      }
      emit('PDF_EXECUTABLE_STAT')
    },
    async observe<T>(stage: Stage, action: () => Promise<T>): Promise<T> {
      const startedAt = performance.now()
      if (stage === 'RESOLVE_CHROMIUM') chromiumResolutionInFlight++
      if (stage === 'LAUNCH') chromiumLaunchInFlight++
      emit(`PDF_${stage}_START`)
      try {
        const value = await action()
        emit(`PDF_${stage}_SUCCESS`, { durationMs: performance.now() - startedAt })
        return value
      } catch (error) {
        failure(`PDF_${stage}_ERROR`, error, performance.now() - startedAt)
        throw error
      } finally {
        if (stage === 'RESOLVE_CHROMIUM') chromiumResolutionInFlight--
        if (stage === 'LAUNCH') chromiumLaunchInFlight--
      }
    },
  }
}

export type PdfTelemetry = ReturnType<typeof createPdfTelemetry>
