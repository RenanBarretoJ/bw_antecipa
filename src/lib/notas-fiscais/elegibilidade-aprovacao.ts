export interface EntradaElegibilidadeAprovacaoNf {
  status: string
  documentos: {
    elegivel: boolean
    requisitosPendentes: string[]
    requisitosRejeitados: string[]
    requisitosEmAnalise: string[]
  }
}

export interface AvaliacaoElegibilidadeAprovacaoNf {
  elegivel: boolean
  bloqueios: Array<{
    codigo: 'nf_nao_submetida' | 'documentos_nao_aprovados'
    mensagem: string
  }>
}

/**
 * A decisão formal de aprovação da NF é posterior à submissão e exige que a
 * análise dos documentos obrigatórios esteja concluída.
 */
export function avaliarElegibilidadeAprovacaoNf(
  input: EntradaElegibilidadeAprovacaoNf,
): AvaliacaoElegibilidadeAprovacaoNf {
  const bloqueios: AvaliacaoElegibilidadeAprovacaoNf['bloqueios'] = []

  if (!['submetida', 'em_analise'].includes(input.status)) {
    bloqueios.push({
      codigo: 'nf_nao_submetida',
      mensagem: 'A NF precisa ser submetida pelo cedente antes da aprovação formal.',
    })
  }

  if (!input.documentos.elegivel) {
    const pendencias = input.documentos.requisitosPendentes.join(', ') || 'checklist documental pendente'
    bloqueios.push({
      codigo: 'documentos_nao_aprovados',
      mensagem: `A NF ainda possui documentos obrigatórios sem aprovação: ${pendencias}.`,
    })
  }

  return { elegivel: bloqueios.length === 0, bloqueios }
}
