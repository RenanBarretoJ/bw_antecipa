import type { TipoBaseFinanceiro } from '@/lib/financeiro/ingestao/types'

export const INTEGRATION_CAPABILITIES = [
  'CESSAO_ENVIO',
  'ESTOQUE',
  'AQUISICOES',
  'LIQUIDACOES',
  'CARTEIRA',
] as const

export type IntegrationCapability = typeof INTEGRATION_CAPABILITIES[number]

export const INTEGRATION_CAPABILITY_LABELS: Record<IntegrationCapability, string> = {
  CESSAO_ENVIO: 'Cessao e envio',
  ESTOQUE: 'Estoque',
  AQUISICOES: 'Aquisicoes',
  LIQUIDACOES: 'Liquidacoes',
  CARTEIRA: 'Carteira',
}

export const FINANCIAL_CAPABILITIES = ['ESTOQUE', 'AQUISICOES', 'LIQUIDACOES', 'CARTEIRA'] as const
export type FinancialIntegrationCapability = typeof FINANCIAL_CAPABILITIES[number]

export const SINQIA_PORTAL_FIDC_CAPABILITIES = [
  'CESSAO_ENVIO',
  'ESTOQUE',
  'AQUISICOES',
  'LIQUIDACOES',
] as const satisfies readonly IntegrationCapability[]

export type OperationalDeliveryMethod = 'CNAB' | 'VRS_CSV'

export const OPERATIONAL_DELIVERY_METHOD_LABELS: Record<OperationalDeliveryMethod, string> = {
  CNAB: 'CNAB',
  VRS_CSV: 'VRS CSV',
}

export function isIntegrationCapability(value: unknown): value is IntegrationCapability {
  return typeof value === 'string' && INTEGRATION_CAPABILITIES.includes(value as IntegrationCapability)
}

export function tipoFinanceiroParaCapability(tipo: TipoBaseFinanceiro): FinancialIntegrationCapability {
  return tipo
}

export function capabilityParaTipoFinanceiro(capability: FinancialIntegrationCapability): TipoBaseFinanceiro {
  return capability
}
