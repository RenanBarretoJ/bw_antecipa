import type { AdminCredencialIntegracao } from './configuracoes-tecnicas'
import type { IntegrationCapability } from '@/lib/integracoes/capabilities'
import { obterAdapterCatalogo } from '@/lib/integracoes/adapter-catalog'

export type ContextoCredencial = {
  fundoId: string
  integrationId: string | null
  providerKey: string
  environment: 'homologacao' | 'producao'
  adapterKey: string | null
  capabilities: readonly IntegrationCapability[]
}

// Pode existir sem integracao; o primeiro vinculo continua exclusivo.
export function credencialCompativel(credential: AdminCredencialIntegracao, context: ContextoCredencial): boolean {
  const kind = obterAdapterCatalogo(context.adapterKey)?.credentialKind ?? 'usuario_senha'
  return credential.fundo_id === context.fundoId
    && (!credential.integracao_fundo_id || credential.integracao_fundo_id === context.integrationId)
    && credential.provider_key === context.providerKey.trim().toUpperCase()
    && credential.ambiente === context.environment
    && credential.credential_type === kind
    && credential.status === 'ativa'
    && credential.revogada_em === null
    && context.capabilities.every((capability) => credential.capabilities.includes(capability))
}
