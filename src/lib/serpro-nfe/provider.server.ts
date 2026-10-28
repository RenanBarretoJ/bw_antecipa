import 'server-only'
import { validarChaveNfe55 } from './key'
import {
  SERPRO_NFE_DF_QUERY_BASE_URL,
  SERPRO_NFE_TOKEN_URL,
} from './official-contract'

const MAX_RESPONSE_BYTES = 1024 * 1024

export class SerproNfeError extends Error {
  constructor(public readonly code: string, public readonly httpStatus?: number) {
    super(code)
    this.name = 'SerproNfeError'
  }
}

export interface SerproNfeRuntimeConfig {
  ready: boolean
  workerEnabled: boolean
  contractVerified: boolean
  queryEnabled: boolean
  consumptionMode: 'OFF_ZERO_BUDGET' | 'UNLIMITED_WITH_METERING' | 'LIMITED' | 'INVALID'
  consumerKey: string
  consumerSecret: string
  tokenUrl: string
  queryBaseUrl: string
  timeoutMs: number
}

export function readSerproNfeRuntimeConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SerproNfeRuntimeConfig {
  const workerEnabled = env.SERPRO_NFE_WORKER_ENABLED === 'true'
  const contractVerified = env.SERPRO_NFE_CONTRACT_VERIFIED === 'true'
  const queryEnabled = env.SERPRO_NFE_QUERY_ENABLED === 'true'
  const configuredConsumptionMode = env.SERPRO_NFE_CONSUMPTION_MODE ?? 'OFF_ZERO_BUDGET'
  const consumptionMode = (
    configuredConsumptionMode === 'OFF_ZERO_BUDGET'
    || configuredConsumptionMode === 'UNLIMITED_WITH_METERING'
    || configuredConsumptionMode === 'LIMITED'
  ) ? configuredConsumptionMode : 'INVALID'
  const consumerKey = env.SERPRO_NFE_CONSUMER_KEY ?? ''
  const consumerSecret = env.SERPRO_NFE_CONSUMER_SECRET ?? ''
  const tokenUrl = env.SERPRO_NFE_TOKEN_URL || SERPRO_NFE_TOKEN_URL
  const queryBaseUrl = env.SERPRO_NFE_BASE_URL || SERPRO_NFE_DF_QUERY_BASE_URL
  const safeEndpoints = tokenUrl === SERPRO_NFE_TOKEN_URL
    && queryBaseUrl === SERPRO_NFE_DF_QUERY_BASE_URL
  return {
    ready: workerEnabled
      && contractVerified
      && queryEnabled
      && consumptionMode === 'UNLIMITED_WITH_METERING'
      && Boolean(consumerKey && consumerSecret)
      && safeEndpoints,
    workerEnabled,
    contractVerified,
    queryEnabled,
    consumptionMode,
    consumerKey,
    consumerSecret,
    tokenUrl,
    queryBaseUrl,
    timeoutMs: 30_000,
  }
}

async function boundedText(response: Response) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_RESPONSE_BYTES) throw new SerproNfeError('RESPONSE_TOO_LARGE', response.status)
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new SerproNfeError('RESPONSE_TOO_LARGE', response.status)
  return text
}

function parseJson(text: string, status: number) {
  try {
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape')
    return value
  } catch {
    throw new SerproNfeError('INVALID_JSON_RESPONSE', status)
  }
}

export async function querySerproNfe(
  chaveAcesso: string,
  config = readSerproNfeRuntimeConfig(),
  fetcher: typeof fetch = fetch,
) {
  if (!config.ready) throw new SerproNfeError('CAPABILITY_UNVERIFIED')
  if (!validarChaveNfe55(chaveAcesso)) throw new SerproNfeError('INVALID_NFE_KEY')
  const signal = AbortSignal.timeout(config.timeoutMs)
  let tokenResponse: Response
  try {
    tokenResponse = await fetcher(config.tokenUrl, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
      redirect: 'error',
      signal,
    })
  } catch (error) {
    throw new SerproNfeError(error instanceof DOMException && error.name === 'TimeoutError' ? 'TOKEN_TIMEOUT' : 'TOKEN_NETWORK_ERROR')
  }
  const tokenText = await boundedText(tokenResponse)
  if (!tokenResponse.ok) throw new SerproNfeError(`TOKEN_HTTP_${tokenResponse.status}`, tokenResponse.status)
  const tokenPayload = parseJson(tokenText, tokenResponse.status) as { access_token?: unknown }
  if (typeof tokenPayload.access_token !== 'string' || !tokenPayload.access_token) throw new SerproNfeError('TOKEN_MISSING')

  let response: Response
  try {
    response = await fetcher(`${config.queryBaseUrl}${encodeURIComponent(chaveAcesso)}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${tokenPayload.access_token}`, accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    throw new SerproNfeError(error instanceof DOMException && error.name === 'TimeoutError' ? 'QUERY_TIMEOUT' : 'QUERY_NETWORK_ERROR')
  }
  const responseText = await boundedText(response)
  if (!response.ok) throw new SerproNfeError(`QUERY_HTTP_${response.status}`, response.status)
  return { payload: parseJson(responseText, response.status), httpStatus: response.status }
}
