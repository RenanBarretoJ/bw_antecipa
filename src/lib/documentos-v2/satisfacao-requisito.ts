import type { PoliticaNivelValidacao } from '@/lib/types/domain'

export type StatusAnaliseRequisito =
  | 'ausente'
  | 'aguardando_analise'
  | 'aprovado'
  | 'rejeitado'
  | 'ajuste_solicitado'

export interface VersaoRequisitoDocumental {
  id: string
  status: string
  ultimaAnalise?: { resultado: string } | null
}

export interface EntradaSatisfacaoRequisito {
  requisitoId: string
  tipoDocumento: string
  obrigatorio: boolean
  bloqueiaFluxo: boolean
  momento: string
  regraValidade: PoliticaNivelValidacao
  statusInstancia: string
  documentoId: string | null
  versaoAprovadaId: string | null
  validacaoEstruturalOk?: boolean
  versoes: VersaoRequisitoDocumental[]
}

export interface SatisfacaoRequisitoSubmissao {
  requisitoId: string
  tipoDocumento: string
  obrigatorio: boolean
  bloqueiaFluxo: boolean
  momento: string
  regraValidade: PoliticaNivelValidacao
  documentoPresente: boolean
  validacaoEstruturalOk: boolean
  statusAnalise: StatusAnaliseRequisito
  satisfazSubmissao: boolean
  motivoBloqueio?: string
}

export interface SatisfacaoRequisitoAprovacao {
  requisitoId: string
  aprovado: boolean
  statusAnalise: StatusAnaliseRequisito
  motivoBloqueio?: string
}

const STATUS_VERSAO_PRESENTE = new Set(['enviado', 'em_analise', 'aprovado', 'rejeitado'])
const STATUS_INSTANCIA_ESTRUTURAL_OK = new Set(['satisfeito', 'aprovado', 'validado', 'concluido'])

function estadoDaVersaoAtual(input: EntradaSatisfacaoRequisito) {
  const versaoAtual = input.versoes[0]
  if (!versaoAtual) return { versaoAtual: null, statusAnalise: 'ausente' as const, aprovado: false }

  const resultado = versaoAtual.ultimaAnalise?.resultado
  const aprovado = input.versaoAprovadaId === versaoAtual.id
    || versaoAtual.status === 'aprovado'
    || resultado === 'aprovado'

  if (aprovado) return { versaoAtual, statusAnalise: 'aprovado' as const, aprovado: true }
  if (versaoAtual.status === 'rejeitado' || resultado === 'rejeitado') {
    return { versaoAtual, statusAnalise: 'rejeitado' as const, aprovado: false }
  }
  if (resultado === 'requer_ajuste') {
    return { versaoAtual, statusAnalise: 'ajuste_solicitado' as const, aprovado: false }
  }
  if (STATUS_VERSAO_PRESENTE.has(versaoAtual.status)) {
    return { versaoAtual, statusAnalise: 'aguardando_analise' as const, aprovado: false }
  }
  return { versaoAtual, statusAnalise: 'ausente' as const, aprovado: false }
}

/**
 * Resolve se um requisito pre-cessao esta suficientemente atendido para que o
 * cedente submeta a NF. Presenca documental e aprovacao da gestora sao marcos
 * distintos: documentos manuais enviados podem aguardar analise.
 */
export function resolverSatisfacaoRequisitoParaSubmissao(
  input: EntradaSatisfacaoRequisito,
): SatisfacaoRequisitoSubmissao {
  const { versaoAtual, statusAnalise, aprovado } = estadoDaVersaoAtual(input)
  const documentoPresente = Boolean(
    input.documentoId
    && versaoAtual
    && STATUS_VERSAO_PRESENTE.has(versaoAtual.status),
  )
  const validacaoEstruturalOk = Boolean(
    input.validacaoEstruturalOk
    || aprovado
    || (documentoPresente && STATUS_INSTANCIA_ESTRUTURAL_OK.has(input.statusInstancia.toLowerCase())),
  )
  const analiseBloqueante = statusAnalise === 'rejeitado' || statusAnalise === 'ajuste_solicitado'

  let satisfazSubmissao = documentoPresente && !analiseBloqueante
  if (input.regraValidade === 'estrutural' || input.regraValidade === 'hibrido') {
    satisfazSubmissao = satisfazSubmissao && validacaoEstruturalOk
  }

  let motivoBloqueio: string | undefined
  if (!documentoPresente) motivoBloqueio = 'Documento obrigatorio ainda nao enviado.'
  else if (statusAnalise === 'rejeitado') motivoBloqueio = 'A versao atual do documento foi rejeitada.'
  else if (statusAnalise === 'ajuste_solicitado') motivoBloqueio = 'A versao atual exige ajuste.'
  else if (!validacaoEstruturalOk && input.regraValidade !== 'manual') {
    motivoBloqueio = 'A validacao estrutural do documento ainda nao foi concluida com sucesso.'
  }

  return {
    requisitoId: input.requisitoId,
    tipoDocumento: input.tipoDocumento,
    obrigatorio: input.obrigatorio,
    bloqueiaFluxo: input.bloqueiaFluxo,
    momento: input.momento,
    regraValidade: input.regraValidade,
    documentoPresente,
    validacaoEstruturalOk,
    statusAnalise,
    satisfazSubmissao,
    motivoBloqueio,
  }
}

/**
 * A aprovacao da NF continua exigindo decisao positiva sobre a versao atual.
 * Esta regra nao e usada para liberar a submissao do cedente.
 */
export function resolverSatisfacaoRequisitoParaAprovacao(
  input: EntradaSatisfacaoRequisito,
): SatisfacaoRequisitoAprovacao {
  const { statusAnalise, aprovado } = estadoDaVersaoAtual(input)
  return {
    requisitoId: input.requisitoId,
    aprovado,
    statusAnalise,
    motivoBloqueio: aprovado
      ? undefined
      : statusAnalise === 'ausente'
        ? 'Documento ainda nao enviado.'
        : statusAnalise === 'rejeitado'
          ? 'Documento rejeitado.'
          : statusAnalise === 'ajuste_solicitado'
            ? 'Documento com ajuste solicitado.'
            : 'Documento aguardando aprovacao da gestora.',
  }
}
