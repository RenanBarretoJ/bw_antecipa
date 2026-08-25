const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Mapeia o codigo da carteira VRS (campo dedicado na UI) para
 * configuracao_nao_sensivel.codigo_carteira, no mesmo padrao ja usado por
 * prepararConfiguracaoFinanceiraDoFundo para relatorios_financeiros.cnpj_fundo
 * -- um campo de dominio nao sensivel dentro do JSON generico da versao.
 */
export function prepararConfiguracaoVortxVrs(input: {
  configuracao: Record<string, unknown>
  codigoCarteira: string
}) {
  const codigoCarteira = input.codigoCarteira.trim()
  if (!codigoCarteira) return input.configuracao
  if (!UUID_PATTERN.test(codigoCarteira)) {
    throw new Error('O codigo da carteira VRS deve ser um UUID valido.')
  }
  return { ...input.configuracao, codigo_carteira: codigoCarteira }
}

export function codigoCarteiraDaConfiguracao(configuracao: Record<string, unknown>): string {
  const value = configuracao.codigo_carteira
  return typeof value === 'string' ? value : ''
}
