export const CONSULTOR_PAPEIS_GESTAO = ['OWNER', 'ADMIN', 'OPERADOR'] as const

export type ConsultorMembershipRole = 'OWNER' | 'ADMIN' | 'OPERADOR' | 'LEITOR'

export function podeGerenciarCarteiraConsultor(papel: ConsultorMembershipRole): boolean {
  return CONSULTOR_PAPEIS_GESTAO.includes(papel as (typeof CONSULTOR_PAPEIS_GESTAO)[number])
}
