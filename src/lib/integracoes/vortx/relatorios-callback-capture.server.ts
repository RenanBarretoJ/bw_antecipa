import 'server-only'
import { constants, createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { CALLBACK_MAX_BODY, CALLBACK_PATH, callbackPreviewPermitido } from './relatorios-callback'

const MAX_METADATA_BYTES = 64 * 1024
const READ_TIMEOUT_MS = 1500
const RPC_TIMEOUT_MS = 1000
type Environment = Readonly<Record<string, string | undefined>>
export type CaptureConfig = { id: string; endpointId: string; fundoId: string; capturarAte: string }
export type CaptureResult = { estado: 'SALVA' | 'IGNORADA' | 'FALHA'; completa?: boolean }
type CaptureRepository = {
  reservar(config: CaptureConfig): Promise<boolean>
  salvar(id: string, envelope: CaptureEnvelope): Promise<boolean>
}
type CapturedBody = { bytes: Buffer; completo: boolean; motivo: 'EOF' | 'LIMITE' | 'TIMEOUT' | 'LEITURA_FALHOU' }
export type CaptureEnvelope = {
  purpose: 'VORTX_CALLBACK_APPLICATION_REQUEST_V1'
  capturaId: string
  endpointId: string
  fundoId: string
  recebidoEm: string
  origemNaoAutenticada: true
  nivelCaptura: 'WEB_REQUEST_APOS_VERCEL_NAO_WIRE'
  metodo: string
  url: string
  headers: [string, string][]
  corpoBase64: string
  hashCorpo: string
  bytesCorpo: number
  corpoCompleto: boolean
  motivoCorpo: CapturedBody['motivo']
  statusHttp: number
}

/** Only a temporary PUBLIC key reaches Vercel; the private key remains on the operator's machine. */
export function criptografarCapturaCallback(envelope: CaptureEnvelope) {
  const key = createPublicKey(process.env.VORTX_REPORT_CALLBACK_RAW_PUBLIC_KEY_PEM || '')
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) throw new Error('CAPTURE_KEY_INVALID')
  const secret = randomBytes(32), iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secret, iv)
  cipher.setAAD(Buffer.from(`VORTX_CALLBACK_APPLICATION_REQUEST_V1:${envelope.capturaId}`))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(envelope), 'utf8'), cipher.final()])
  const wrapped = publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, secret)
  return { ciphertext: ['rsa1', wrapped.toString('base64url'), iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(':'), chaveVersao: 'capture-rsa-v1' }
}

/** No token/header is accepted as authorization by this independent diagnostic selector. */
export function configurarCapturaCallback(request: Request, env: Environment = process.env, now = Date.now()): CaptureConfig | null {
  if (!callbackPreviewPermitido(env) || request.method !== 'POST') return null
  const id = env.VORTX_REPORT_CALLBACK_RAW_CAPTURE_ID
  const endpointId = env.VORTX_REPORT_CALLBACK_RAW_ENDPOINT_ID
  const fundoId = env.VORTX_REPORTS_PREVIEW_FUNDO_ID
  const until = env.VORTX_REPORT_CALLBACK_RAW_CAPTURE_UNTIL
  if (![id, endpointId, fundoId].every(value => z.uuid().safeParse(value).success)
    || !until || !z.iso.datetime().safeParse(until).success) return null
  const deadline = Date.parse(until)
  if (deadline <= now || deadline > now + 2 * 3600000) return null
  try {
    const url = new URL(request.url), endpoints = url.searchParams.getAll('endpoint')
    if (url.protocol !== 'https:' || url.pathname !== CALLBACK_PATH || endpoints.length !== 1
      || endpoints[0].toLowerCase() !== endpointId!.toLowerCase()) return null
  } catch { return null }
  return { id: id!, endpointId: endpointId!, fundoId: fundoId!, capturarAte: new Date(deadline).toISOString() }
}

async function lerCorpoCapturado(request: Request): Promise<CapturedBody> {
  if (!request.body) return { bytes: Buffer.alloc(0), completo: true, motivo: 'EOF' }
  const reader = request.body.getReader(), chunks: Buffer[] = []
  let length = 0, timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('READ_TIMEOUT')), READ_TIMEOUT_MS) })
  let motivo: CapturedBody['motivo'] = 'EOF'
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), deadline])
      if (next.done) break
      const remaining = CALLBACK_MAX_BODY - length
      chunks.push(Buffer.from(next.value.subarray(0, remaining)))
      length += Math.min(next.value.byteLength, remaining)
      if (next.value.byteLength > remaining) { motivo = 'LIMITE'; break }
    }
  } catch (error) { motivo = error instanceof Error && error.message === 'READ_TIMEOUT' ? 'TIMEOUT' : 'LEITURA_FALHOU' }
  finally {
    clearTimeout(timer)
    // A tee cancellation may wait for the other branch. Never await it or alter the canonical request.
    if (motivo !== 'EOF') void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return { bytes: Buffer.concat(chunks), completo: motivo === 'EOF', motivo }
}

function criarRepositorioCaptura(): CaptureRepository {
  const client = createAdminClient()
  return {
    async reservar(config) {
      const result = await client.rpc('vortx_reservar_captura_callback', {
        p_id: config.id, p_endpoint_id: config.endpointId, p_fundo_id: config.fundoId,
      }).abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
      if (result.error) throw new Error('CAPTURE_RESERVATION_FAILED')
      return z.object({ estado: z.enum(['RESERVADA', 'IGNORADA']) }).parse(result.data).estado === 'RESERVADA'
    },
    async salvar(id, envelope) {
      const serialized = JSON.stringify(envelope)
      const sealed = criptografarCapturaCallback(envelope)
      const result = await client.rpc('vortx_concluir_captura_callback', {
        p_id: id, p_ciphertext: sealed.ciphertext, p_chave_versao: sealed.chaveVersao,
        p_hash: createHash('sha256').update(serialized).digest('hex'),
        p_bytes: envelope.bytesCorpo, p_completo: envelope.corpoCompleto, p_status: envelope.statusHttp,
      }).abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
      if (result.error) throw new Error('CAPTURE_PERSISTENCE_FAILED')
      return z.object({ estado: z.enum(['SALVA', 'IGNORADA']) }).parse(result.data).estado === 'SALVA'
    },
  }
}

/** Clone before normal processing; never replace/authorize/replay the canonical request. */
export function iniciarCapturaCallback(request: Request,
  repositoryFactory: () => CaptureRepository = criarRepositorioCaptura,
  env: Environment = process.env,
): ((statusHttp: number) => Promise<CaptureResult>) | null {
  const config = configurarCapturaCallback(request, env)
  if (!config) return null
  let copy: Request
  try { copy = request.clone() } catch { return async () => ({ estado: 'FALHA' }) }
  const recebidoEm = new Date().toISOString()
  return async statusHttp => {
    try {
      const repository = repositoryFactory()
      if (!await repository.reservar(config)) return { estado: 'IGNORADA' }
      const headers: [string, string][] = Array.from(copy.headers.entries())
      if (Buffer.byteLength(JSON.stringify({ url: copy.url, headers }), 'utf8') > MAX_METADATA_BYTES) return { estado: 'FALHA' }
      const body = await lerCorpoCapturado(copy)
      const envelope: CaptureEnvelope = {
        purpose: 'VORTX_CALLBACK_APPLICATION_REQUEST_V1', capturaId: config.id,
        endpointId: config.endpointId, fundoId: config.fundoId, recebidoEm,
        origemNaoAutenticada: true, nivelCaptura: 'WEB_REQUEST_APOS_VERCEL_NAO_WIRE',
        metodo: copy.method, url: copy.url, headers, corpoBase64: body.bytes.toString('base64'),
        hashCorpo: createHash('sha256').update(body.bytes).digest('hex'), bytesCorpo: body.bytes.length,
        corpoCompleto: body.completo, motivoCorpo: body.motivo, statusHttp,
      }
      return await repository.salvar(config.id, envelope) ? { estado: 'SALVA', completa: body.completo } : { estado: 'IGNORADA' }
    } catch { return { estado: 'FALHA' } }
    finally { if (copy.body && !copy.bodyUsed) void copy.body.cancel().catch(() => {}) }
  }
}
