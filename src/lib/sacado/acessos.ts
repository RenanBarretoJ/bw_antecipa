export type SacadoAcesso = {
  user_id: string
  sacado_id: string
  cnpj: string
  razao_social: string
  fundo_id: string
  status: string
}

export function normalizarCnpjSacado(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '')
}

export function possuiAcessoSacado(acessos: readonly SacadoAcesso[], cnpj: string, fundoId: string | null): boolean {
  const completo = normalizarCnpjSacado(cnpj)
  return completo.length === 14 && !!fundoId && acessos.some(a =>
    a.status === 'ativo' && a.cnpj === completo && a.fundo_id === fundoId)
}

/** A URL filter narrows an authorized set; it can never grant access. */
export function filtrarAcessosSacado(acessos: readonly SacadoAcesso[], cnpj?: string): SacadoAcesso[] {
  if (!cnpj) return [...acessos]
  const completo = normalizarCnpjSacado(cnpj)
  if (completo.length !== 14) return []
  return acessos.filter(a => a.status === 'ativo' && a.cnpj === completo)
}
