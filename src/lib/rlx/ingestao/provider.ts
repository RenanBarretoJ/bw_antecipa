import type { FinancialIntegrationCapability } from '@/lib/integracoes/capabilities'
import type { ResolvedIntegrationVersion } from '@/lib/integracoes/resolver.server'
import type { RlxTipoBase } from './types'
import { createSinqiaPortalFidcFinancialHandlers } from './sinqia-portal-fidc.server'

export interface RlxArquivoExterno {
  fundoId: string
  provedor: string
  tipoBase: RlxTipoBase
  dataReferencia: string
  nomeArquivo: string
  mimeType: string
  conteudo: Uint8Array
}

export interface RlxCapabilityRequest {
  dataOperacional: string
  dataReferencia: string
  integrationVersion: ResolvedIntegrationVersion
}

export interface RlxCapabilityHandler {
  adapterKey: string
  capability: FinancialIntegrationCapability
  obterArquivo(input: RlxCapabilityRequest): Promise<RlxArquivoExterno>
}

export class RlxProviderTimeoutError extends Error {
  constructor(adapterKey: string, capability: FinancialIntegrationCapability, timeoutMs: number) {
    super(`Adapter ${adapterKey}/${capability} excedeu o timeout individual de ${timeoutMs} ms.`)
    this.name = 'RlxProviderTimeoutError'
  }
}

export function createRlxCapabilityHandlerRegistry(handlers: readonly RlxCapabilityHandler[]) {
  const byKey = new Map(handlers.map((handler) => [`${handler.adapterKey}:${handler.capability}`, handler]))
  return {
    list: () => [...handlers],
    get: (adapterKey: string, capability: FinancialIntegrationCapability) => byKey.get(`${adapterKey}:${capability}`) ?? null,
  }
}

export const rlxCapabilityHandlerRegistry = createRlxCapabilityHandlerRegistry([
  ...createSinqiaPortalFidcFinancialHandlers(),
])

export async function obterArquivoCapabilityComTimeout(
  handler: RlxCapabilityHandler,
  input: RlxCapabilityRequest,
  timeoutMs = Number(process.env.RLX_PROVIDER_TIMEOUT_MS || 120_000),
): Promise<RlxArquivoExterno> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('Timeout individual do provider invalido.')
  }

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      handler.obterArquivo(input),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new RlxProviderTimeoutError(handler.adapterKey, handler.capability, timeoutMs)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
