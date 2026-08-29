const CODIGO_CARTEIRA_PATTERN = /^[A-Za-z0-9._-]{1,100}$/

export interface VortxVrsInclusaoConfig {
  termo: string
  cnpj_originador: string
  tipo_preco: string
  metodo_preco: string
  modalidade_operacao: string
  registradora: string
}

/**
 * Mapeia o codigo da carteira VRS (campo dedicado na UI) para
 * configuracao_nao_sensivel.codigo_carteira, no mesmo padrao ja usado por
 * prepararConfiguracaoFinanceiraDoFundo para relatorios_financeiros.cnpj_fundo
 * -- um campo de dominio nao sensivel dentro do JSON generico da versao.
 */
export function prepararConfiguracaoVortxVrs(input: {
  configuracao: Record<string, unknown>
  codigoCarteira: string
  inclusao?: VortxVrsInclusaoConfig
}) {
  const codigoCarteira = input.codigoCarteira.trim()
  if (codigoCarteira && !CODIGO_CARTEIRA_PATTERN.test(codigoCarteira)) {
    throw new Error('O codigo da carteira VRS deve ter de 1 a 100 caracteres alfanumericos (tambem: -._).')
  }
  if (!codigoCarteira && !input.inclusao) return input.configuracao
  const inclusao = input.inclusao
    ? {
        termo: input.inclusao.termo.trim(),
        cnpj_originador: input.inclusao.cnpj_originador.replace(/\D/g, ''),
        tipo_preco: input.inclusao.tipo_preco.trim().toUpperCase(),
        metodo_preco: input.inclusao.metodo_preco.trim(),
        modalidade_operacao: input.inclusao.modalidade_operacao.replace(/\D/g, ''),
        registradora: input.inclusao.registradora.trim().toUpperCase(),
      }
    : input.configuracao.vrs_inclusao
  return input.inclusao
    ? { ...input.configuracao, codigo_carteira: codigoCarteira, vrs_inclusao: inclusao }
    : { ...input.configuracao, codigo_carteira: codigoCarteira }
}

export function configuracaoInclusaoVrs(configuracao: Record<string, unknown>): VortxVrsInclusaoConfig {
  const value = configuracao.vrs_inclusao
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const read = (key: string) => typeof row[key] === 'string' ? row[key] as string : ''
  return {
    termo: read('termo'),
    cnpj_originador: read('cnpj_originador'),
    tipo_preco: read('tipo_preco'),
    metodo_preco: read('metodo_preco'),
    modalidade_operacao: read('modalidade_operacao'),
    registradora: read('registradora'),
  }
}

export function validarConfiguracaoInclusaoVrs(configuracao: Record<string, unknown>): string | null {
  const codigoCarteira = codigoCarteiraDaConfiguracao(configuracao)
  const inclusao = configuracaoInclusaoVrs(configuracao)
  if (!CODIGO_CARTEIRA_PATTERN.test(codigoCarteira)) return 'Informe o codigo da carteira VRS conforme o contrato de Inclusao.'
  if (!inclusao.termo) return 'Informe o termo VRS para a remessa de Inclusao.'
  if (!/^\d{14}$/.test(inclusao.cnpj_originador)) return 'Informe o CNPJ do originador VRS com 14 digitos.'
  if (!['POSFIXADO', 'PREFIXADO'].includes(inclusao.tipo_preco)) return 'Selecione o tipo de preco VRS.'
  if (!inclusao.metodo_preco) return 'Informe o metodo de preco VRS.'
  if (!/^\d{4}$/.test(inclusao.modalidade_operacao)) return 'Informe a modalidade da operacao VRS com 4 digitos.'
  if (!['B3', 'CERC'].includes(inclusao.registradora)) return 'Selecione a registradora VRS.'
  return null
}

export function codigoCarteiraDaConfiguracao(configuracao: Record<string, unknown>): string {
  const value = configuracao.codigo_carteira
  return typeof value === 'string' ? value : ''
}
