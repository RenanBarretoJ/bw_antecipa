import 'server-only'
import { z } from 'zod'
import { IntakeError } from '../contracts'

const GRAPH_ORIGIN = 'https://graph.microsoft.com'
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive() })
const credentialSchema = z.object({ tenantId: z.uuid(), clientId: z.uuid(), clientSecret: z.string().min(1) })
export type GraphCredentials = z.infer<typeof credentialSchema>
export type HttpDependencies = { fetch?: typeof fetch; now?: () => number }

export async function readBoundedBody(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    throw new IntakeError('FILE_TOO_LARGE')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new IntakeError('INVALID_RESPONSE')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      length += result.value.length
      if (length > limit) throw new IntakeError('FILE_TOO_LARGE')
      chunks.push(result.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

export function validateGraphUrl(raw: string, expectedPath?: string): URL {
  let url: URL
  try { url = new URL(raw, GRAPH_ORIGIN) } catch { throw new IntakeError('INVALID_CURSOR') }
  if (url.origin !== GRAPH_ORIGIN || url.username || url.password || url.hash
    || !url.pathname.startsWith('/v1.0/') || (expectedPath && url.pathname !== expectedPath)) {
    throw new IntakeError('INVALID_CURSOR')
  }
  return url
}

function httpError(response: Response, now: number): IntakeError {
  const retry = response.headers.get('retry-after')
  const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - now : 0
  const retryMs = Number.isFinite(delay) ? Math.max(0, delay) : 0
  if (response.status === 429) return new IntakeError('THROTTLED', true, retryMs)
  if (response.status >= 500 || response.status === 408) return new IntakeError('PROVIDER_UNAVAILABLE', true, retryMs)
  if (response.status === 401) return new IntakeError('AUTHENTICATION')
  if (response.status === 403) return new IntakeError('ACCESS_DENIED')
  if (response.status === 404) return new IntakeError('NOT_FOUND')
  if (response.status === 410) return new IntakeError('CURSOR_EXPIRED')
  return new IntakeError('INVALID_RESPONSE')
}

export class GraphHttpClient {
  private token: { value: string; expiresAt: number } | null = null
  private tokenRequest: Promise<string> | null = null
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly credentials: GraphCredentials
  constructor(credentials: GraphCredentials, dependencies: HttpDependencies = {}) {
    const parsed = credentialSchema.safeParse(credentials)
    if (!parsed.success) throw new IntakeError('CONFIGURATION')
    this.credentials = parsed.data
    this.fetcher = dependencies.fetch ?? fetch
    this.now = dependencies.now ?? Date.now
  }

  private async send(url: string | URL, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(url, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    } catch { throw new IntakeError('PROVIDER_UNAVAILABLE', true) }
  }

  private async acquireToken(): Promise<string> {
    const response = await this.send(`https://login.microsoftonline.com/${this.credentials.tenantId}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.credentials.clientId, client_secret: this.credentials.clientSecret,
        scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    })
    if (!response.ok) { await response.body?.cancel(); throw httpError(response, this.now()) }
    let payload: unknown
    try { payload = JSON.parse(new TextDecoder().decode(await readBoundedBody(response, 64 * 1024))) }
    catch { throw new IntakeError('INVALID_RESPONSE') }
    const parsed = tokenSchema.safeParse(payload)
    if (!parsed.success) throw new IntakeError('INVALID_RESPONSE')
    this.token = { value: parsed.data.access_token, expiresAt: this.now() + Math.max(0, parsed.data.expires_in - 60) * 1000 }
    return this.token.value
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value
    if (!this.tokenRequest) this.tokenRequest = this.acquireToken().finally(() => { this.tokenRequest = null })
    return this.tokenRequest
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = validateGraphUrl(path)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${await this.accessToken()}`)
    headers.set('Prefer', 'IdType="ImmutableId"')
    const response = await this.send(url, { ...init, headers })
    if (!response.ok) {
      if (response.status === 401) this.token = null
      await response.body?.cancel()
      throw httpError(response, this.now())
    }
    return response
  }

  async json<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init)
    let payload: unknown
    try { payload = JSON.parse(new TextDecoder().decode(await readBoundedBody(response, 2 * 1024 * 1024))) }
    catch { throw new IntakeError('INVALID_RESPONSE') }
    const parsed = schema.safeParse(payload)
    if (!parsed.success) throw new IntakeError('INVALID_RESPONSE')
    return parsed.data
  }
}
