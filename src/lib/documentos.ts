// Validade em dias por tipo de documento (teto de 1 ano)
export const VALIDADE_DIAS: Record<string, number> = {
  contrato_social: 365,
  cartao_cnpj: 365,
  comprovante_endereco: 90,
  extrato_bancario: 90,
  balanco_patrimonial: 365,
  dre: 365,
  rg_cpf: 365,
  comprovante_de_renda: 90,
  procuracao: 365,
}

export interface ExpiracaoDoc {
  expirado: boolean
  diasRestantes: number | null
  dataExpiracao: Date | null
}

export function calcularExpiracaoDoc(analisadoEm: string | null, tipo: string): ExpiracaoDoc {
  if (!analisadoEm) return { expirado: false, diasRestantes: null, dataExpiracao: null }

  const validadeDias = VALIDADE_DIAS[tipo]
  if (!validadeDias) return { expirado: false, diasRestantes: null, dataExpiracao: null }

  const dataExpiracao = new Date(analisadoEm)
  dataExpiracao.setDate(dataExpiracao.getDate() + validadeDias)

  const hoje = new Date()
  const diffMs = dataExpiracao.getTime() - hoje.getTime()
  const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  return { expirado: diasRestantes < 0, diasRestantes, dataExpiracao }
}
