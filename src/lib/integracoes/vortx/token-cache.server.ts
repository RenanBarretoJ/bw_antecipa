import 'server-only'

export type VortxAmbiente = 'homologacao' | 'producao'
export type VortxTokenCacheKey = { fundoId: string; ambiente: VortxAmbiente }
export type VortxTokenCacheEntry = { accessToken: string; expiraEm: number }

const MARGEM_SEGURANCA_MS = 120_000

const cache = new Map<string, VortxTokenCacheEntry>()

function chaveCache(chave: VortxTokenCacheKey) {
  return `${chave.fundoId}:${chave.ambiente}`
}

/** created + expiresIn, com margem de seguranca de 120s antes de considerar expirado. */
export function tokenAindaValido(expiraEm: number, agoraMs: number, margemMs = MARGEM_SEGURANCA_MS) {
  return agoraMs < expiraEm - margemMs
}

export function obterTokenValidoCache(chave: VortxTokenCacheKey, agoraMs: number = Date.now()): string | null {
  const entry = cache.get(chaveCache(chave))
  if (!entry || !tokenAindaValido(entry.expiraEm, agoraMs)) return null
  return entry.accessToken
}

export function salvarTokenCache(chave: VortxTokenCacheKey, entry: VortxTokenCacheEntry) {
  cache.set(chaveCache(chave), entry)
}

export function limparTokenCache(chave?: VortxTokenCacheKey) {
  if (!chave) {
    cache.clear()
    return
  }
  cache.delete(chaveCache(chave))
}
