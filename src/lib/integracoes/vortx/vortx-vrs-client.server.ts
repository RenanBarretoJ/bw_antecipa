import 'server-only'

import { postJsonMtls } from './mtls-http-client.server'
import { obterTokenValidoCache, salvarTokenCache } from './token-cache.server'
import type { VortxVrsConfig } from './credenciais.server'

export type VortxVrsLoginResult = {
  accessToken: string
  refreshToken: string
  created: string
  expiresIn: number
}

function parseLoginResponse(body: unknown): VortxVrsLoginResult {
  const data = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>).data
    : null
  const record = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null
  const accessToken = record?.accessToken
  const refreshToken = record?.refreshToken
  const created = record?.created
  const expiresIn = record?.expiresIn

  if (
    typeof accessToken !== 'string' || !accessToken
    || typeof refreshToken !== 'string' || !refreshToken
    || typeof created !== 'string' || Number.isNaN(Date.parse(created))
    || typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0
  ) {
    throw Object.assign(
      new Error('Resposta de login da Vortx incompleta ou em formato inesperado.'),
      { categoria: 'resposta_inesperada' },
    )
  }
  return { accessToken, refreshToken, created, expiresIn }
}

/**
 * Chama POST /v2/auth/login e retorna o resultado bruto (accessToken tratado
 * como opaque token). Nao consulta nem grava cache -- use
 * obterAccessTokenVortxVrs para o fluxo com cache.
 */
export async function autenticarVortxVrs(config: VortxVrsConfig): Promise<VortxVrsLoginResult> {
  const resultado = await postJsonMtls({
    baseUrl: config.baseUrl,
    path: '/v2/auth/login',
    body: { Key: config.key, Secret: config.secret },
    credential: config.credential,
  })

  if (resultado.statusCode === 401 || resultado.statusCode === 403) {
    throw Object.assign(new Error('Credenciais Vortx VRS invalidas.'), { categoria: 'autenticacao' })
  }
  if (resultado.statusCode < 200 || resultado.statusCode >= 300) {
    throw Object.assign(
      new Error(`A Vortx VRS respondeu HTTP ${resultado.statusCode}.`),
      { categoria: 'resposta_inesperada' },
    )
  }
  return parseLoginResponse(resultado.body)
}

/**
 * Retorna um accessToken valido reutilizando o cache server-side quando
 * possivel (margem de seguranca de 120s antes de created+expiresIn);
 * reautentica automaticamente quando ausente ou proximo de expirar.
 * NAO implementa refresh token (endpoint ainda nao confirmado pela Vortx).
 */
export async function obterAccessTokenVortxVrs(config: VortxVrsConfig): Promise<string> {
  const chave = { fundoId: config.fundoId, ambiente: config.ambiente }
  const cacheado = obterTokenValidoCache(chave)
  if (cacheado) return cacheado

  const login = await autenticarVortxVrs(config)
  const expiraEm = Date.parse(login.created) + login.expiresIn * 1000
  salvarTokenCache(chave, { accessToken: login.accessToken, expiraEm })
  return login.accessToken
}
