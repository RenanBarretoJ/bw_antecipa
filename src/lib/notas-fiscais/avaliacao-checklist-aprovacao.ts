import type { PoliticaNivelValidacao } from '@/lib/types/domain'
import { resolverSatisfacaoRequisitoParaAprovacao } from '@/lib/documentos-v2/satisfacao-requisito'

export type RequisitoAprovacaoComDados = {
  notaFiscalId: string
  requisitoId: string
  nome: string
  tipoDocumento: string
  escopo: string
  obrigatorio: boolean
  bloqueiaFluxo: boolean
  momento: string
  regraValidade: PoliticaNivelValidacao
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
  elegivel: boolean
  requisitosPendentes: string[]
  requisitosRejeitados: string[]
  requisitosEmAnalise: string[]
  motivos: string[]
  totalObrigatorios: number
  concluidosObrigatorios: number
  pendentesObrigatorios: number
  possuiRejeicao: boolean
}

/**
 * Regra pura usada pela listagem e pelas aprovacoes individual e em lote.
 * Recebe somente dados ja autorizados e nao executa I/O.
 */
export function avaliarChecklistDaNotaComDados(input: {
  notaFiscalId: string
  requisitos: RequisitoAprovacaoComDados[]
}): AvaliacaoChecklistAprovacao {
  const requisitosDaNota = input.requisitos.filter(
    (item) => item.notaFiscalId === input.notaFiscalId && item.escopo === 'nf_pre_cessao',
  )

  if (requisitosDaNota.length === 0) {
    return {
      elegivel: false,
      requisitosPendentes: ['Checklist documental'],
      requisitosRejeitados: [],
      requisitosEmAnalise: [],
      motivos: ['Checklist documental da NF ainda nao foi instanciado.'],
      totalObrigatorios: 0,
      concluidosObrigatorios: 0,
      pendentesObrigatorios: 1,
      possuiRejeicao: false,
    }
  }

  const obrigatorios = requisitosDaNota.filter(
    (item) => item.obrigatorio || item.bloqueiaFluxo,
  )
  const avaliados = obrigatorios.map((item) => ({
    item,
    satisfacao: resolverSatisfacaoRequisitoParaAprovacao({
      requisitoId: item.requisitoId,
      tipoDocumento: item.tipoDocumento,
      obrigatorio: item.obrigatorio,
      bloqueiaFluxo: item.bloqueiaFluxo,
      momento: item.momento,
      regraValidade: item.regraValidade,
      statusInstancia: item.statusInstancia,
      documentoId: item.documentoId,
      versaoAprovadaId: item.versaoAprovadaId,
      versoes: item.versaoAtual ? [item.versaoAtual] : [],
    }),
  }))

  const pendentes = avaliados.filter(({ satisfacao }) => !satisfacao.aprovado)
  const rejeitados = avaliados.filter(({ satisfacao }) =>
    ['rejeitado', 'ajuste_solicitado'].includes(satisfacao.statusAnalise))
  const emAnalise = avaliados.filter(
    ({ satisfacao }) => satisfacao.statusAnalise === 'aguardando_analise',
  )

  return {
    elegivel: pendentes.length === 0,
    requisitosPendentes: pendentes.map(({ item }) => item.nome),
    requisitosRejeitados: rejeitados.map(({ item }) => item.nome),
    requisitosEmAnalise: emAnalise.map(({ item }) => item.nome),
    motivos: pendentes.map(({ item, satisfacao }) =>
      `${item.nome}: ${satisfacao.motivoBloqueio || 'aprovacao documental pendente'}`),
    totalObrigatorios: obrigatorios.length,
    concluidosObrigatorios: obrigatorios.length - pendentes.length,
    pendentesObrigatorios: pendentes.length,
    possuiRejeicao: rejeitados.length > 0,
  }
}
