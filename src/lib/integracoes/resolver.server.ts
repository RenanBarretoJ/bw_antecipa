import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'
import { isIntegrationCapability, type IntegrationCapability } from './capabilities'
import { integrationProviderRegistry } from './registry.server'

export type IntegrationEnvironment = 'homologacao' | 'producao'

export interface ResolvedIntegrationVersion {
  fundoId: string
  integrationId: string
  integrationVersionId: string
  providerKey: string
  systemName: string
  adapterKey: string
  environment: IntegrationEnvironment
  capability: IntegrationCapability
  version: number
  endpointBase: string
  clientIdentifier: string
  originatorCode: string | null
  credentialReference: string
  credentialId: string
  config: Record<string, unknown>
}

export type IntegrationResolution =
  | { status: 'CONFIGURADA'; integrationVersion: ResolvedIntegrationVersion }
  | { status: 'NAO_CONFIGURADA' | 'INDISPONIVEL'; reason: string }

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function integrationRuntimeEnvironment(): IntegrationEnvironment {
  const configured = process.env.INTEGRATION_RUNTIME_ENV || process.env.NEXT_PUBLIC_APP_ENV
  if (configured === 'homologacao' || configured === 'producao') return configured
  if (configured === 'homolog') return 'homologacao'
  if (configured === 'production' || configured === 'prod') return 'producao'
  if (process.env.NODE_ENV !== 'production') return 'homologacao'
  throw new Error('INTEGRATION_RUNTIME_ENV deve ser configurado explicitamente em runtime de producao.')
}

export async function resolverIntegracaoPorCapability(
  input: { fundoId: string; ambiente: IntegrationEnvironment; capability: IntegrationCapability },
  client: RpcClient = createAdminClient(),
): Promise<IntegrationResolution> {
  if (!isIntegrationCapability(input.capability)) return { status: 'NAO_CONFIGURADA', reason: 'CAPABILITY_INVALIDA' }
  const { data, error } = await client.rpc('resolver_integracao_por_capability', {
    p_fundo_id: input.fundoId,
    p_ambiente: input.ambiente,
    p_capability: input.capability,
  })
  if (error) throw new Error(`Nao foi possivel resolver a integracao tecnica: ${error.message}`)
  const row = object(data)
  const status = row?.status
  if (status === 'NAO_CONFIGURADA' || status === 'INDISPONIVEL') {
    return { status, reason: requiredString(row?.motivo) || 'MOTIVO_NAO_INFORMADO' }
  }
  if (status !== 'CONFIGURADA') return { status: 'INDISPONIVEL', reason: 'RESPOSTA_INVALIDA' }

  const adapterKey = requiredString(row?.adapter_key)
  if (!adapterKey) return { status: 'INDISPONIVEL', reason: 'ADAPTER_NAO_IMPLEMENTADO' }
  const adapter = integrationProviderRegistry.get(adapterKey)
  if (!adapter) return { status: 'INDISPONIVEL', reason: 'ADAPTER_NAO_IMPLEMENTADO' }
  if (!adapter.supports.includes(input.capability)) return { status: 'INDISPONIVEL', reason: 'CAPABILITY_NAO_SUPORTADA_PELO_ADAPTER' }

  const values = {
    integrationId: requiredString(row?.integracao_fundo_id),
    integrationVersionId: requiredString(row?.integracao_fundo_versao_id),
    providerKey: requiredString(row?.provider_key),
    systemName: requiredString(row?.system_name),
    endpointBase: requiredString(row?.endpoint_base),
    credentialReference: requiredString(row?.credential_ref),
    credentialId: requiredString(row?.credencial_integracao_id),
  }
  if (!values.integrationId || !values.integrationVersionId || !values.providerKey || !values.systemName) {
    return { status: 'INDISPONIVEL', reason: 'CONFIGURACAO_INCOMPLETA' }
  }
  if (adapter.requiresEndpoint && !values.endpointBase) return { status: 'INDISPONIVEL', reason: 'ENDPOINT_INDISPONIVEL' }
  if (adapter.requiresCredential && (!values.credentialReference || !values.credentialId)) {
    return { status: 'INDISPONIVEL', reason: 'CREDENCIAL_INDISPONIVEL' }
  }

  return {
    status: 'CONFIGURADA',
    integrationVersion: {
      fundoId: input.fundoId,
      integrationId: values.integrationId!,
      integrationVersionId: values.integrationVersionId!,
      providerKey: values.providerKey!,
      systemName: values.systemName!,
      adapterKey,
      environment: input.ambiente,
      capability: input.capability,
      version: typeof row?.versao === 'number' ? row.versao : Number(row?.versao),
      endpointBase: values.endpointBase || '',
      clientIdentifier: requiredString(row?.identificador_cliente) || '',
      originatorCode: requiredString(row?.codigo_originador),
      credentialReference: values.credentialReference || '',
      credentialId: values.credentialId || '',
      config: object(row?.configuracao_nao_sensivel) || {},
    },
  }
}
