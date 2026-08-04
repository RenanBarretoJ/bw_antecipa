import type { EstadoElegibilidadeDocumentalNota } from './avaliacao-checklist-aprovacao'

export interface EntradaElegibilidadeAprovacaoNf {
  status: string
  documentos: {
    elegivel: boolean
    estado: EstadoElegibilidadeDocumentalNota
    requisitosPendentes: string[]
    requisitosRejeitados: string[]
    requisitosEmAnalise: string[]
    ausentesMaterializacao: string[]
  }
}

export interface AvaliacaoElegibilidadeAprovacaoNf {
  elegivel: boolean
  bloqueios: Array<{
    codigo:
      | 'nf_nao_submetida'
      | 'politica_documental_nao_resolvida'
      | 'arquivo_original_ausente'
      | 'requisitos_nao_instanciados'
      | 'documentos_nao_aprovados'
    mensagem: string
  }>
}

/**
 * A decisao formal de aprovacao da NF e posterior a submissao e mantem os
 * bloqueios de configuracao, arquivo e documentos separados.
 */
export function avaliarElegibilidadeAprovacaoNf(
  input: EntradaElegibilidadeAprovacaoNf,
): AvaliacaoElegibilidadeAprovacaoNf {
  const bloqueios: AvaliacaoElegibilidadeAprovacaoNf['bloqueios'] = []

  if (!['submetida', 'em_analise'].includes(input.status)) {
    bloqueios.push({
      codigo: 'nf_nao_submetida',
      mensagem: 'A NF precisa ser submetida pelo cedente antes da aprovacao formal.',
    })
  }

  if (input.documentos.estado === 'configuracao_invalida') {
    bloqueios.push({
      codigo: 'politica_documental_nao_resolvida',
      mensagem: 'Nao foi possivel identificar a politica documental aplicavel a NF.',
    })
  } else if (input.documentos.estado === 'arquivo_original_ausente') {
    bloqueios.push({
      codigo: 'arquivo_original_ausente',
      mensagem: 'A NF nao possui arquivo original PDF ou XML valido.',
    })
  } else if (input.documentos.estado === 'nao_instanciado') {
    const requisitos = input.documentos.ausentesMaterializacao.join(', ')
    bloqueios.push({
      codigo: 'requisitos_nao_instanciados',
      mensagem: `Nao foi possivel preparar os requisitos documentais da politica para esta NF: ${requisitos}.`,
    })
  } else if (!input.documentos.elegivel) {
    const pendencias = input.documentos.requisitosPendentes.join(', ')
    bloqueios.push({
      codigo: 'documentos_nao_aprovados',
      mensagem: `A NF ainda possui documentos obrigatorios sem aprovacao: ${pendencias}.`,
    })
  }

  return { elegivel: bloqueios.length === 0, bloqueios }
}
