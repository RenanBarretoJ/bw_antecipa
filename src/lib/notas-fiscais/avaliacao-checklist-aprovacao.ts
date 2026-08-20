import type { PoliticaNivelValidacao } from '@/lib/types/domain'
import { resolverSatisfacaoRequisitoParaAprovacao } from '@/lib/documentos-v2/satisfacao-requisito'

export type FontePoliticaDocumentalNota = 'politica_publicada' | 'snapshot_operacao'

export type EstadoElegibilidadeDocumentalNota =
  | 'nao_aplicavel'
  | 'completo'
  | 'pendente'
  | 'nao_instanciado'
  | 'configuracao_invalida'
  | 'arquivo_original_ausente'

export type PoliticaDocumentalResolvidaNota = {
  resolvida: boolean
  fonte: FontePoliticaDocumentalNota | null
  politicaId: string | null
  versaoId: string | null
}

export type RequisitoEsperadoAprovacao = {
  id: string
  nome: string
  tipoDocumento: string
  escopo: string
  obrigatorio: boolean
  bloqueiaFluxo: boolean
  momento: string
  regraValidade: PoliticaNivelValidacao
  ativo: boolean
}

export type InstanciaRequisitoAprovacao = {
  notaFiscalId: string
  requisitoId: string
  politicaVersaoId: string | null
  statusInstancia: string
  documentoId: string | null
  versaoAprovadaId: string | null
  versaoAtual: {
    id: string
    status: string
    ultimaAnalise: { resultado: string } | null
  } | null
}

export type AvaliacaoChecklistAprovacao = {
  aplicavel: boolean
  elegivel: boolean
  estado: EstadoElegibilidadeDocumentalNota
  fontePolitica: FontePoliticaDocumentalNota | null
  requisitosPendentes: string[]
  requisitosRejeitados: string[]
  requisitosEmAnalise: string[]
  ausentesMaterializacao: string[]
  errosConfiguracao: string[]
  motivos: string[]
  totalEsperados: number
  totalObrigatorios: number
  concluidosObrigatorios: number
  pendentesObrigatorios: number
  possuiRejeicao: boolean
  arquivoOriginalValido: boolean
}

export function arquivoOriginalDaNotaValido(caminho: string | null | undefined): boolean {
  if (!caminho?.trim()) return false
  const caminhoSemParametros = caminho.trim().split(/[?#]/, 1)[0]
  return /\.(pdf|xml)$/i.test(caminhoSemParametros)
}

/**
 * Gate documental formal da NF. A politica e os requisitos esperados precisam
 * ter sido resolvidos antes da chamada; uma colecao vazia so significa
 * "nao aplicavel" quando a politica foi efetivamente identificada.
 */
export function avaliarElegibilidadeDocumentalDaNota(input: {
  notaFiscalId: string
  politica: PoliticaDocumentalResolvidaNota
  requisitosEsperados: RequisitoEsperadoAprovacao[]
  instancias: InstanciaRequisitoAprovacao[]
  arquivoOriginal: string | null
}): AvaliacaoChecklistAprovacao {
  const arquivoOriginalValido = arquivoOriginalDaNotaValido(input.arquivoOriginal)
  const requisitosAplicaveis = input.requisitosEsperados.filter(
    (item) => item.ativo && item.escopo === 'nf_pre_cessao',
  )
  const obrigatorios = requisitosAplicaveis.filter(
    (item) => item.obrigatorio || item.bloqueiaFluxo,
  )
  // Requisitos por_parcela (ex.: boleto) tem UMA instancia por parcela, todas
  // compartilhando o mesmo requisitoId -- agrupar em lista (nao um Map 1:1)
  // preserva todas; um Map 1:1 colapsaria para a ultima instancia lida,
  // aprovando a NF com base em so uma parcela.
  const instanciasPorRequisito = new Map<string, InstanciaRequisitoAprovacao[]>()
  for (const item of input.instancias) {
    if (item.notaFiscalId !== input.notaFiscalId || item.politicaVersaoId !== input.politica.versaoId) continue
    const atuais = instanciasPorRequisito.get(item.requisitoId) || []
    atuais.push(item)
    instanciasPorRequisito.set(item.requisitoId, atuais)
  }
  const ausentes = obrigatorios.filter((item) => !instanciasPorRequisito.has(item.id))
  const materializados = obrigatorios
    .filter((item) => instanciasPorRequisito.has(item.id))
    .map((item) => {
      const instancias = instanciasPorRequisito.get(item.id)!
      const satisfacoes = instancias.map((instancia) => resolverSatisfacaoRequisitoParaAprovacao({
        requisitoId: item.id,
        tipoDocumento: item.tipoDocumento,
        obrigatorio: item.obrigatorio,
        bloqueiaFluxo: item.bloqueiaFluxo,
        momento: item.momento,
        regraValidade: item.regraValidade,
        statusInstancia: instancia.statusInstancia,
        documentoId: instancia.documentoId,
        versaoAprovadaId: instancia.versaoAprovadaId,
        versoes: instancia.versaoAtual ? [instancia.versaoAtual] : [],
      }))
      // Todas as parcelas precisam estar aprovadas (0/4..3/4 aprovados =
      // requisito ainda pendente); a pior satisfacao representa o
      // requisito inteiro no resumo. Para requisitos por_nf (1 instancia)
      // isso reduz exatamente ao comportamento anterior.
      const satisfacao = satisfacoes.find((candidata) => !candidata.aprovado) || satisfacoes[0]
      return { item, satisfacao }
    })
  const pendentesMaterializados = materializados.filter(({ satisfacao }) => !satisfacao.aprovado)
  const rejeitados = pendentesMaterializados.filter(({ satisfacao }) => (
    satisfacao.statusAnalise === 'rejeitado'
    || satisfacao.statusAnalise === 'ajuste_solicitado'
  ))
  const emAnalise = pendentesMaterializados.filter(
    ({ satisfacao }) => satisfacao.statusAnalise === 'aguardando_analise',
  )
  const requisitosPendentes = [
    ...ausentes.map((item) => item.nome),
    ...pendentesMaterializados.map(({ item }) => item.nome),
  ]
  const errosConfiguracao = input.politica.resolvida
    ? []
    : ['Nao foi possivel identificar a politica documental aplicavel a NF.']
  const motivos = [
    ...ausentes.map((item) => `${item.nome}: requisito documental nao materializado.`),
    ...pendentesMaterializados.map(({ item, satisfacao }) => (
      `${item.nome}: ${satisfacao.motivoBloqueio || 'aprovacao documental pendente'}`
    )),
  ]

  let estado: EstadoElegibilidadeDocumentalNota
  if (!input.politica.resolvida) estado = 'configuracao_invalida'
  else if (!arquivoOriginalValido) estado = 'arquivo_original_ausente'
  else if (ausentes.length > 0) estado = 'nao_instanciado'
  else if (pendentesMaterializados.length > 0) estado = 'pendente'
  else if (requisitosAplicaveis.length === 0) estado = 'nao_aplicavel'
  else estado = 'completo'

  return {
    aplicavel: input.politica.resolvida && requisitosAplicaveis.length > 0,
    elegivel: ['nao_aplicavel', 'completo'].includes(estado),
    estado,
    fontePolitica: input.politica.fonte,
    requisitosPendentes,
    requisitosRejeitados: rejeitados.map(({ item }) => item.nome),
    requisitosEmAnalise: emAnalise.map(({ item }) => item.nome),
    ausentesMaterializacao: ausentes.map((item) => item.nome),
    errosConfiguracao,
    motivos,
    totalEsperados: requisitosAplicaveis.length,
    totalObrigatorios: obrigatorios.length,
    concluidosObrigatorios: obrigatorios.length - requisitosPendentes.length,
    pendentesObrigatorios: requisitosPendentes.length,
    possuiRejeicao: rejeitados.length > 0,
    arquivoOriginalValido,
  }
}
