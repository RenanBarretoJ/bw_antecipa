import { INTEGRATION_CAPABILITIES, SINQIA_PORTAL_FIDC_CAPABILITIES, type IntegrationCapability } from './capabilities'

// Capabilities suportadas pela Vortx VRS 2.0 neste momento. 'CARTEIRA' fica de
// fora deliberadamente ate o contrato dessa capability ser fechado com a
// Vortx (P0_Claude_Vortx_VRS2_Adapter_Orientado_Tab_Integracoes).
export const VORTX_VRS_CAPABILITIES = [
  'CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES',
] as const satisfies readonly IntegrationCapability[]

export type IntegrationEnvironment = 'homologacao' | 'producao'
export type AdapterCredentialKind = 'usuario_senha' | 'vortx_mtls'

export interface AdapterCatalogEntry {
  adapterKey: string
  label: string
  providerKey: string
  systemName: string
  capabilities: readonly IntegrationCapability[]
  environments: readonly IntegrationEnvironment[]
  defaultBaseUrl: Partial<Record<IntegrationEnvironment, string>>
  credentialKind: AdapterCredentialKind
  /** Quando false, o Endpoint generico deixa de ser exibido/editavel -- a URL real vive na credencial do adapter. */
  showsGenericEndpoint: boolean
  /** Quando false, oculta os campos manuais Provider/Nome do sistema/JSON livre -- o adapter ja define essa identidade. */
  showsGenericIdentity: boolean
  /** Identificador do cliente (usado por regras de publicacao especificas, ex.: Sinqia/CESSAO_ENVIO). */
  showsClientIdentifier: boolean
}

/**
 * Catalogo central de adapters conhecidos pela tab Integracoes. Evita
 * `if (provider === 'VORTX')` espalhado: a UI e o server leem metadados
 * daqui em vez de hardcodar por adapter. 'CUSTOM' (adapterKey === '') e o
 * modo generico legado -- preserva a experiencia atual (campos manuais)
 * para qualquer sistema ainda nao catalogado.
 */
export const ADAPTER_CATALOG: readonly AdapterCatalogEntry[] = [
  {
    adapterKey: 'sinqia_portal_fidc',
    label: 'Portal FIDC — Sinqia',
    providerKey: 'SINQIA',
    systemName: 'Portal FIDC',
    capabilities: SINQIA_PORTAL_FIDC_CAPABILITIES,
    environments: ['homologacao', 'producao'],
    defaultBaseUrl: {},
    credentialKind: 'usuario_senha',
    showsGenericEndpoint: true,
    showsGenericIdentity: false,
    showsClientIdentifier: true,
  },
  {
    adapterKey: 'vortx_vrs',
    label: 'Vórtx — VRS 2.0',
    providerKey: 'VORTX',
    systemName: 'Vórtx VRS 2.0',
    capabilities: VORTX_VRS_CAPABILITIES,
    environments: ['homologacao', 'producao'],
    defaultBaseUrl: { homologacao: 'https://api-stg.vortx.com.br' },
    credentialKind: 'vortx_mtls',
    showsGenericEndpoint: false,
    showsGenericIdentity: false,
    showsClientIdentifier: false,
  },
]

export function obterAdapterCatalogo(adapterKey: string | null | undefined): AdapterCatalogEntry | null {
  if (!adapterKey) return null
  return ADAPTER_CATALOG.find((item) => item.adapterKey === adapterKey) ?? null
}

export function capabilitiesDisponiveisParaAdapter(adapterKey: string | null | undefined): readonly IntegrationCapability[] {
  const catalogo = obterAdapterCatalogo(adapterKey)
  return catalogo ? catalogo.capabilities : INTEGRATION_CAPABILITIES
}
