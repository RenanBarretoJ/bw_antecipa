export const FUNDO_ATIVO_COOKIE = 'bw_fundo_ativo_id'

export type FundoAtivoAutorizado = {
  userId: string
  tenantId: string | null
  fundoId: string | null
  perfilNoFundo: string | null
  consolidado: boolean
}

export type FundoAutorizado = {
  id: string
  nome: string
  cnpj: string | null
  status: string
  perfilNoFundo: string
  principal: boolean
}

export function escolherFundoInicial({
  fundos,
  cookieFundoId,
}: {
  fundos: FundoAutorizado[]
  cookieFundoId?: string | null
}) {
  if (fundos.length === 0) return null
  const cookieValido = cookieFundoId ? fundos.find((fundo) => fundo.id === cookieFundoId) : null
  if (cookieValido) return cookieValido
  return fundos.find((fundo) => fundo.principal) || fundos[0]
}

export function canUseTodosOsFundos(perfilNoFundo?: string | null) {
  return perfilNoFundo === 'plataforma'
}
