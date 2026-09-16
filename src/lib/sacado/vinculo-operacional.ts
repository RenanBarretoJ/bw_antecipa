export type VinculoOperacional = { nota_fiscal_id: string; operacao_id: string }
export type OperacaoVinculada = { id: string; status: string }

// O vínculo em operacoes_nfs é histórico. Apenas operações canceladas ou
// reprovadas liberam a NF; liquidada permanece uma cessão operacional.
export function operacaoContaComoVinculoAtivo(status: string): boolean {
  return status !== 'cancelada' && status !== 'reprovada'
}

export function agruparVinculosOperacionaisAtivos(
  vinculos: VinculoOperacional[],
  operacoes: OperacaoVinculada[],
): Map<string, Set<string>> {
  const statusPorOperacao = new Map(operacoes.map((operacao) => [operacao.id, operacao.status]))
  const porNota = new Map<string, Set<string>>()

  for (const vinculo of vinculos) {
    const status = statusPorOperacao.get(vinculo.operacao_id)
    if (!status) throw new Error('Operacao vinculada nao esta acessivel.')
    if (!operacaoContaComoVinculoAtivo(status)) continue
    const ids = porNota.get(vinculo.nota_fiscal_id) ?? new Set<string>()
    ids.add(vinculo.operacao_id)
    porNota.set(vinculo.nota_fiscal_id, ids)
  }

  return porNota
}
