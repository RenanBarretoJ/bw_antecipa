import 'server-only'

import { VORTX_VRS_CAPABILITIES } from './adapter-catalog'
import {
  SINQIA_PORTAL_FIDC_CAPABILITIES,
  type IntegrationCapability,
  type OperationalDeliveryMethod,
} from './capabilities'
import type { EstrategiaAgrupamentoRemessa, RemessaFormato } from '@/lib/remessas/domain'
import { validarConfiguracaoInclusaoVrs } from './configuracao-vortx-vrs'

export interface OperationalRemittanceDefinition {
  formato: RemessaFormato
  estrategiaAgrupamento: EstrategiaAgrupamentoRemessa
  envioAutomaticoSuportado: boolean
  motivoBloqueioEnvio?: string
}

export interface IntegrationAdapterDefinition {
  key: string
  label: string
  supports: readonly IntegrationCapability[]
  deliveryMethods: Partial<Record<IntegrationCapability, readonly OperationalDeliveryMethod[]>>
  operationalRemittance?: OperationalRemittanceDefinition
  requiresCredential: boolean
  requiresEndpoint: boolean
  validatePublication(input: {
    capabilities: readonly IntegrationCapability[]
    clientIdentifier: string
    originatorCode: string | null
    config: Record<string, unknown>
  }): string | null
  testConnection(input: { endpoint: string; username: string; password: string; timeoutMs: number }): Promise<IntegrationConnectionTestResult>
}

export interface IntegrationConnectionTestResult {
  ok: boolean
  statusCode: string
  message: string
  errorCategory: '' | 'autenticacao' | 'resposta_inesperada'
}

const adapters: readonly IntegrationAdapterDefinition[] = [
  {
    key: 'sinqia_portal_fidc',
    label: 'Portal FIDC / Sinqia',
    supports: SINQIA_PORTAL_FIDC_CAPABILITIES,
    deliveryMethods: { CESSAO_ENVIO: ['CNAB'] },
    operationalRemittance: {
      formato: 'CNAB444',
      estrategiaAgrupamento: 'POR_LOTE',
      envioAutomaticoSuportado: true,
    },
    requiresCredential: true,
    requiresEndpoint: true,
    validatePublication({ capabilities, clientIdentifier, originatorCode, config }) {
      if (capabilities.includes('CESSAO_ENVIO')) {
        if (!clientIdentifier.trim()) return 'Informe o identificador do cliente antes de publicar o envio de cessao.'
        if (!originatorCode?.trim()) return 'Publique a configuracao CNAB antes de publicar o envio de cessao.'
      }
      if (capabilities.some((item) => item === 'ESTOQUE' || item === 'AQUISICOES' || item === 'LIQUIDACOES')) {
        const reports = config.relatorios_financeiros
        const fundDocument = reports && typeof reports === 'object' && !Array.isArray(reports)
          ? (reports as Record<string, unknown>).cnpj_fundo
          : null
        if (typeof fundDocument !== 'string' || !/^\d{14}$/.test(fundDocument)) {
          return 'Informe configuracao_nao_sensivel.relatorios_financeiros.cnpj_fundo com 14 digitos.'
        }
      }
      return null
    },
    async testConnection({ endpoint, username, password, timeoutMs }) {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { username, password },
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      })
      const ok = response.status < 500 && response.status !== 401 && response.status !== 403
      return {
        ok,
        statusCode: String(response.status),
        message: `Teste tecnico HTTP ${response.status}.`,
        errorCategory: ok ? '' : response.status === 401 || response.status === 403 ? 'autenticacao' : 'resposta_inesperada',
      }
    },
  },
  {
    key: 'vortx_vrs',
    label: 'Vórtx — VRS 2.0',
    supports: VORTX_VRS_CAPABILITIES,
    deliveryMethods: { CESSAO_ENVIO: ['VRS_CSV'] },
    operationalRemittance: {
      formato: 'VRS_CSV',
      estrategiaAgrupamento: 'POR_CEDENTE',
      envioAutomaticoSuportado: false,
      motivoBloqueioEnvio: 'Envio Vortx VRS indisponivel: metodo, URL e headers de upload ainda nao foram confirmados contratualmente.',
    },
    // A credencial Vortx (Key/Secret + certificado/chave mTLS) vive em
    // integracoes_vortx_vrs_credenciais, fora de credenciais_integracao --
    // por isso nao usa o fluxo generico credencial_integracao_id. A
    // existencia de uma credencial ativa e validada separadamente em
    // validarIntegracaoParaPublicacao (configuracoes-tecnicas-actions.ts).
    requiresCredential: false,
    // O endpoint real (base_url) tambem vive na credencial Vortx, nao no
    // endpoint_base generico da versao.
    requiresEndpoint: false,
    validatePublication({ capabilities, config }) {
      return capabilities.includes('CESSAO_ENVIO') ? validarConfiguracaoInclusaoVrs(config) : null
    },
    async testConnection() {
      return {
        ok: false,
        statusCode: '',
        message: 'Use o teste de conexao dedicado da Vortx VRS (mTLS) na secao Credenciais.',
        errorCategory: 'resposta_inesperada',
      }
    },
  },
]

export function createIntegrationProviderRegistry(definitions: readonly IntegrationAdapterDefinition[]) {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]))
  return {
    list: () => [...definitions],
    get: (adapterKey: string | null | undefined) => adapterKey ? byKey.get(adapterKey) ?? null : null,
    supports: (adapterKey: string | null | undefined, capability: IntegrationCapability) => {
      const adapter = adapterKey ? byKey.get(adapterKey) : null
      return adapter?.supports.includes(capability) ?? false
    },
  }
}

export const integrationProviderRegistry = createIntegrationProviderRegistry(adapters)

export function resolverMetodoEnvioOperacional(
  adapterKey: string,
  capability: IntegrationCapability,
): OperationalDeliveryMethod | null {
  const methods = integrationProviderRegistry.get(adapterKey)?.deliveryMethods[capability] ?? []
  return methods.length === 1 ? methods[0] : null
}

export function resolverDefinicaoRemessaOperacional(adapterKey: string): OperationalRemittanceDefinition | null {
  return integrationProviderRegistry.get(adapterKey)?.operationalRemittance ?? null
}
