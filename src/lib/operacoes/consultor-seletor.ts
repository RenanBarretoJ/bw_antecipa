export const LIMITE_CEDENTES_SELETOR = 10
export const MINIMO_CARACTERES_BUSCA_CEDENTE = 4

export function normalizarTermoBuscaCedente(value: string) {
  return value.trim().replace(/\s+/gu, ' ').slice(0, 80)
}

export function deveExecutarBuscaCedentes(termo: string) {
  const tamanho = normalizarTermoBuscaCedente(termo).length
  return tamanho === 0 || tamanho >= MINIMO_CARACTERES_BUSCA_CEDENTE
}

export function parametrosAoSelecionarCedente(
  atuais: URLSearchParams,
  cedenteId: string,
) {
  const params = new URLSearchParams(atuais.toString())
  params.set('cedente', cedenteId)
  for (const chave of [
    'q', 'page', 'pagina', 'busca', 'status', 'ordenacao', 'direcao', 'limite',
    'valorMin', 'valorMax', 'emissaoDe', 'emissaoAte', 'vencimentoDe', 'vencimentoAte',
  ]) {
    params.delete(chave)
  }
  return params
}
