export const TIPOS_RELATORIO_VORTX = ['Inclusao', 'Exclusao', 'PosicaoAtivo', 'PosicaoParcela'] as const
export type TipoRelatorioVortx = typeof TIPOS_RELATORIO_VORTX[number]

export function relatorioDePosicao(tipo: TipoRelatorioVortx): boolean {
  return tipo === 'PosicaoAtivo' || tipo === 'PosicaoParcela'
}

// Explicit provider vocabulary only. Never infer an unsupported report from a substring.
const callbackAliases: Readonly<Record<string, TipoRelatorioVortx>> = {
  inclusao: 'Inclusao', exclusao: 'Exclusao',
  posicaoativo: 'PosicaoAtivo', 'posicao ativo': 'PosicaoAtivo',
  posicaoparcela: 'PosicaoParcela', 'posicao parcela': 'PosicaoParcela',
  posicaonivelativo: 'PosicaoAtivo', posicaonivelparcela: 'PosicaoParcela',
}
export function normalizarTipoCallbackVortx(value: string): TipoRelatorioVortx | null {
  const key = value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return Object.hasOwn(callbackAliases, key) ? callbackAliases[key] : null
}
