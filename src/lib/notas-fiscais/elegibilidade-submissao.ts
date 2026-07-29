export type BloqueioSubmissaoNf = {
  codigo:
    | 'status_invalido'
    | 'contexto_invalido'
    | 'politica_ausente'
    | 'requisitos_nao_instanciados'
    | 'documentos_pendentes'
    | 'dados_incompletos'
    | 'validacao_fiscal'
    | 'operacao_incompativel'
  mensagem: string
}

export type AvaliacaoElegibilidadeSubmissaoNf = {
  elegivel: boolean
  estado: 'incompleta' | 'pronta_para_submissao' | 'bloqueada'
  obrigatorios: {
    total: number
    concluidos: number
    pendentes: number
  }
  bloqueios: BloqueioSubmissaoNf[]
}

export type ItemElegibilidadeSubmissaoNf = {
  nome: string
  obrigatorio: boolean
  satisfazSubmissao: boolean
  bloqueiaFluxo?: boolean
}

export type EntradaElegibilidadeSubmissaoNf = {
  status: string
  contexto: {
    cedenteFundoAtivo: boolean
    fundoAtivo: boolean
  }
  politica: {
    publicadaVigente: boolean
  }
  requisitos: {
    instanciados: boolean
    preCessao: ItemElegibilidadeSubmissaoNf[]
    posCessao?: ItemElegibilidadeSubmissaoNf[]
    validacaoEstruturalOk: boolean
    erroFiscal: string | null
  }
  dadosObrigatoriosCompletos: boolean
  operacaoIncompativel?: boolean
}

/**
 * Fonte única da decisão de prontidão para submissão.
 * A função é pura para que a mesma regra possa ser usada pela UI, pela ação
 * server-side e por testes sem confiar em estado duplicado no navegador.
 */
export function avaliarElegibilidadeSubmissaoNf(
  input: EntradaElegibilidadeSubmissaoNf,
): AvaliacaoElegibilidadeSubmissaoNf {
  // Requisitos pós-cessão não participam da submissão inicial por definição.
  const obrigatorios = input.requisitos.preCessao.filter((item) => item.obrigatorio || item.bloqueiaFluxo)
  const concluidos = obrigatorios.filter((item) => item.satisfazSubmissao).length
  const pendentes = obrigatorios.length - concluidos
  const bloqueios: BloqueioSubmissaoNf[] = []

  if (input.status !== 'rascunho') {
    bloqueios.push({ codigo: 'status_invalido', mensagem: 'A NF não está em rascunho e não pode ser submetida novamente.' })
  }
  if (!input.contexto.cedenteFundoAtivo || !input.contexto.fundoAtivo) {
    bloqueios.push({ codigo: 'contexto_invalido', mensagem: 'O vínculo ativo entre cedente e fundo não foi confirmado.' })
  }
  if (!input.politica.publicadaVigente) {
    bloqueios.push({ codigo: 'politica_ausente', mensagem: 'A NF não possui política operacional publicada vigente.' })
  }
  if (!input.requisitos.instanciados) {
    bloqueios.push({ codigo: 'requisitos_nao_instanciados', mensagem: 'Os requisitos documentais ainda não foram instanciados para esta NF.' })
  }
  if (pendentes > 0) {
    bloqueios.push({
      codigo: 'documentos_pendentes',
      mensagem: `${pendentes} requisito(s) pré-cessão obrigatório(s) ainda não está(ão) concluído(s).`,
    })
  }
  if (!input.requisitos.validacaoEstruturalOk) {
    bloqueios.push({ codigo: 'validacao_fiscal', mensagem: 'A validação estrutural/fiscal da NF ainda não foi concluída.' })
  }
  if (input.requisitos.erroFiscal) {
    bloqueios.push({ codigo: 'validacao_fiscal', mensagem: input.requisitos.erroFiscal })
  }
  if (!input.dadosObrigatoriosCompletos) {
    bloqueios.push({ codigo: 'dados_incompletos', mensagem: 'Preencha os dados obrigatórios da NF antes de submetê-la.' })
  }
  if (input.operacaoIncompativel) {
    bloqueios.push({ codigo: 'operacao_incompativel', mensagem: 'A NF está vinculada a uma operação incompatível com nova submissão.' })
  }

  const elegivel = bloqueios.length === 0
  return {
    elegivel,
    estado: elegivel ? 'pronta_para_submissao' : input.status === 'rascunho' ? 'incompleta' : 'bloqueada',
    obrigatorios: { total: obrigatorios.length, concluidos, pendentes },
    bloqueios,
  }
}
