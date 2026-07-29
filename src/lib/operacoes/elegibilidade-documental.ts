import { normalizarCodigoDocumentoCatalogo } from '@/lib/documentos-v2/codigos'
import { resolverSatisfacaoRequisitoParaAprovacao } from '@/lib/documentos-v2/satisfacao-requisito'
import type {
  NotaFiscalElegibilidadeComDados,
  RequisitoElegibilidadeComDados,
} from '@/lib/notas-fiscais/listagem'
import type { ElegibilidadeDocumental } from '@/lib/actions/documento-v2'

/**
 * Regra pura de elegibilidade documental para entrada e aprovacao de operacao.
 * O carregamento/autorizacao dos dados fica fora desta funcao.
 */
export function avaliarElegibilidadeDocumentalParaOperacao(input: {
  notaFiscal: NotaFiscalElegibilidadeComDados
  requisitos: RequisitoElegibilidadeComDados[]
}): ElegibilidadeDocumental {
  const bloqueantes = input.requisitos.filter((requisito) => (
    requisito.escopo === 'nf_pre_cessao'
    && (requisito.obrigatorio || requisito.bloqueiaFluxo)
  ))
  const avaliados = bloqueantes.map((requisito) => ({
    requisito,
    satisfacao: resolverSatisfacaoRequisitoParaAprovacao({
      requisitoId: requisito.id,
      tipoDocumento: normalizarCodigoDocumentoCatalogo(requisito.codigo),
      obrigatorio: requisito.obrigatorio,
      bloqueiaFluxo: requisito.bloqueiaFluxo,
      momento: requisito.momentoObrigatorio,
      regraValidade: requisito.nivelValidacao,
      statusInstancia: requisito.statusInstancia,
      documentoId: requisito.documentoId,
      versaoAprovadaId: requisito.versaoAprovadaId,
      versoes: requisito.versaoAtual ? [requisito.versaoAtual] : [],
    }),
  }))
  const pendentes = avaliados.filter((item) => !item.satisfacao.aprovado)
  const rejeitados = pendentes.filter((item) => (
    item.satisfacao.statusAnalise === 'rejeitado'
    || item.satisfacao.statusAnalise === 'ajuste_solicitado'
  ))
  const emAnalise = pendentes.filter((item) => item.satisfacao.statusAnalise === 'aguardando_analise')
  const nome = (item: (typeof avaliados)[number]) => normalizarCodigoDocumentoCatalogo(item.requisito.codigo)

  return {
    elegivel: pendentes.length === 0,
    requisitosPendentes: pendentes.map(nome),
    requisitosRejeitados: rejeitados.map(nome),
    requisitosEmAnalise: emAnalise.map(nome),
    motivos: pendentes.map((item) => (
      `${nome(item)}: ${item.satisfacao.motivoBloqueio || 'requisito documental pendente'}`
    )),
    totalObrigatorios: bloqueantes.length,
    concluidosObrigatorios: bloqueantes.length - pendentes.length,
    pendentesObrigatorios: pendentes.length,
  }
}

export function avaliarLoteDocumentalParaOperacao(input: {
  notas: NotaFiscalElegibilidadeComDados[]
  requisitosPorNota: Map<string, RequisitoElegibilidadeComDados[]>
}) {
  return new Map(input.notas.map((notaFiscal) => [
    notaFiscal.id,
    avaliarElegibilidadeDocumentalParaOperacao({
      notaFiscal,
      requisitos: input.requisitosPorNota.get(notaFiscal.id) || [],
    }),
  ]))
}
