import { FINANCIAL_CAPABILITIES, type IntegrationCapability } from './capabilities'

const somenteDigitos = (value: string) => value.replace(/\D/g, '')

export function possuiCapabilityFinanceira(capabilities: readonly IntegrationCapability[]) {
  return capabilities.some((capability) => FINANCIAL_CAPABILITIES.includes(
    capability as (typeof FINANCIAL_CAPABILITIES)[number],
  ))
}

export function prepararConfiguracaoFinanceiraDoFundo(input: {
  configuracao: Record<string, unknown>
  capabilities: readonly IntegrationCapability[]
  cnpjFundo: string
}) {
  if (!possuiCapabilityFinanceira(input.capabilities)) return input.configuracao

  const cnpjFundo = somenteDigitos(input.cnpjFundo)
  if (!/^\d{14}$/.test(cnpjFundo)) {
    throw new Error('O CNPJ cadastrado do fundo deve possuir 14 digitos para habilitar relatorios financeiros.')
  }

  const atual = input.configuracao.relatorios_financeiros
  const relatoriosFinanceiros = atual && typeof atual === 'object' && !Array.isArray(atual)
    ? atual as Record<string, unknown>
    : {}

  return {
    ...input.configuracao,
    relatorios_financeiros: {
      ...relatoriosFinanceiros,
      cnpj_fundo: cnpjFundo,
    },
  }
}
