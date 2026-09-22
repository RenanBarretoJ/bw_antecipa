import 'server-only'

import { consultarCnpj, validarCnpjServer, type CnpjConsultaResult } from '@/lib/cadastro/cnpj.server'

type ConsultaCnpj = (cnpj: string) => Promise<CnpjConsultaResult>

type CacheEntry = {
  razaoSocial: string | null
  expiresAt: number
}

export type DestinatarioResolution = {
  razaoSocial: string
  source: 'document' | 'cnpj_lookup' | 'unresolved'
}

const POSITIVE_TTL_MS = 6 * 60 * 60 * 1_000
const NEGATIVE_TTL_MS = 60 * 1_000
const MAX_CACHE_ENTRIES = 500

function normalizarRazaoSocial(value: string | null | undefined): string {
  return (value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

function limparCacheExpirado(cache: Map<string, CacheEntry>, now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined
    if (!oldestKey) break
    cache.delete(oldestKey)
  }
}

/**
 * Completa a razao social somente quando o documento nao a trouxe. Consultas
 * iguais em andamento sao compartilhadas e o cache curto evita repetir a
 * BrasilAPI para varias NFs do mesmo sacado no mesmo runtime serverless.
 */
export function createDestinatarioResolver(options: {
  consultar?: ConsultaCnpj
  now?: () => number
} = {}) {
  const consulta = options.consultar || consultarCnpj
  const now = options.now || Date.now
  const cache = new Map<string, CacheEntry>()
  const inFlight = new Map<string, Promise<string | null>>()

  return async function resolverRazaoSocialDestinatario(input: {
    cnpj: string | null | undefined
    razaoSocial: string | null | undefined
  }): Promise<DestinatarioResolution> {
    const documentName = normalizarRazaoSocial(input.razaoSocial)
    if (documentName) return { razaoSocial: documentName, source: 'document' }

    const cnpj = (input.cnpj || '').replace(/\D/g, '')
    if (!validarCnpjServer(cnpj)) return { razaoSocial: '', source: 'unresolved' }

    const currentTime = now()
    limparCacheExpirado(cache, currentTime)
    const cached = cache.get(cnpj)
    if (cached && cached.expiresAt > currentTime) {
      return cached.razaoSocial
        ? { razaoSocial: cached.razaoSocial, source: 'cnpj_lookup' }
        : { razaoSocial: '', source: 'unresolved' }
    }

    let pending = inFlight.get(cnpj)
    if (!pending) {
      pending = consulta(cnpj)
        .then((result) => result.ok ? normalizarRazaoSocial(result.dados.razao_social) || null : null)
        .catch(() => null)
        .finally(() => inFlight.delete(cnpj))
      inFlight.set(cnpj, pending)
    }

    const razaoSocial = await pending
    cache.set(cnpj, {
      razaoSocial,
      expiresAt: currentTime + (razaoSocial ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
    })
    return razaoSocial
      ? { razaoSocial, source: 'cnpj_lookup' }
      : { razaoSocial: '', source: 'unresolved' }
  }
}

export const resolverRazaoSocialDestinatario = createDestinatarioResolver()
