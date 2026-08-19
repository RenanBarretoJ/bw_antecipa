import type { NfStatus, PoliticaNivelValidacao } from '@/lib/types/domain'
import {
  avaliarElegibilidadeSubmissaoNf,
  type AvaliacaoElegibilidadeSubmissaoNf,
} from './elegibilidade-submissao'
import { resolverSatisfacaoRequisitoParaSubmissao } from '@/lib/documentos-v2/satisfacao-requisito'
import { normalizarCodigoDocumentoCatalogo } from '@/lib/documentos-v2/codigos'
import {
  ALLOWED_PAGE_SIZES,
  buildOffsetRange,
  normalizePage,
  normalizePageSize,
  parseSortParams,
  type AllowedPageSize,
} from '@/lib/pagination'

export const LIMITES_LISTAGEM_NF = ALLOWED_PAGE_SIZES
export type LimiteListagemNf = AllowedPageSize

export const CAMPOS_ORDENACAO_LISTAGEM_NF = [
  'created_at',
  'numero_nf',
  'valor_bruto',
  'data_emissao',
  'data_vencimento',
  'status',
] as const
export type CampoOrdenacaoListagemNf = (typeof CAMPOS_ORDENACAO_LISTAGEM_NF)[number]
export type DirecaoOrdenacaoListagemNf = 'asc' | 'desc'

export type EstadoSubmissaoNf =
  | 'rascunho_incompleto'
  | 'pronta_para_submissao'
  | 'submetida'
  | 'em_analise'
  | 'aprovada'
  | 'reprovada'
  | 'antecipada'
  | 'cancelada'

export type ResumoDocumentalListagemNf = {
  elegivel: boolean
  totalObrigatorios: number
  totalSatisfeitos: number
  totalPendentes: number
}

export type NotaFiscalListagem = {
  id: string
  numero: string
  serie: string | null
  destinatario: string
  cnpjDestinatario: string
  valorBruto: number
  emissao: string
  vencimento: string
  status: NfStatus
  entregaStatus: string | null
  estadoSubmissao: EstadoSubmissaoNf
  resumoDocumental?: ResumoDocumentalListagemNf
}

export type NotaFiscalElegibilidadeComDados = {
  id: string
  status: string
  numero: string | null
  dataEmissao: string | null
  dataVencimento: string | null
  cnpjEmitente: string | null
  razaoSocialEmitente: string | null
  cnpjDestinatario: string | null
  razaoSocialDestinatario: string | null
  valorBruto: number
}

export type RequisitoElegibilidadeComDados = {
  id: string
  notaFiscalId: string
  codigo: string
  escopo: string
  obrigatorio: boolean
  bloqueiaFluxo: boolean
  momentoObrigatorio: string
  nivelValidacao: PoliticaNivelValidacao
  statusInstancia: string
  documentoId: string | null
  versaoAprovadaId: string | null
  /** Requisito de cardinalidade por_parcela: id da parcela a que esta instancia se refere; null = requisito por NF inteira (legado). */
  parcelaId: string | null
  versaoAtual: {
    id: string
    status: string
    ultimaAnalise: { resultado: string } | null
  } | null
}

export type ContextoElegibilidadeComDados = {
  cedenteFundoAtivo: boolean
  fundoAtivo: boolean
  politicaPublicadaVigente: boolean
  requisitosInstanciados: boolean
  operacaoIncompativel: boolean
}

const DOCUMENTOS_COM_VALIDACAO_ESTRUTURAL = new Set([
  'nf_xml',
  'nf_danfe_pdf',
  'cte_xml',
])

function dadosObrigatoriosCompletos(notaFiscal: NotaFiscalElegibilidadeComDados) {
  return Boolean(
    notaFiscal.numero
    && notaFiscal.dataEmissao
    && notaFiscal.dataVencimento
    && notaFiscal.cnpjEmitente
    && notaFiscal.razaoSocialEmitente
    && notaFiscal.cnpjDestinatario
    && notaFiscal.razaoSocialDestinatario
    && Number(notaFiscal.valorBruto) > 0
  )
}

/**
 * Regra pura compartilhável entre a leitura individual e a leitura em lote.
 * Todos os dados externos devem estar autorizados e carregados antes da chamada.
 */
export function avaliarElegibilidadeSubmissaoNfComDados(input: {
  notaFiscal: NotaFiscalElegibilidadeComDados
  requisitos: RequisitoElegibilidadeComDados[]
  contexto: ContextoElegibilidadeComDados
}): AvaliacaoElegibilidadeSubmissaoNf {
  const requisitosPreCessao = input.requisitos
    .filter((requisito) => requisito.escopo === 'nf_pre_cessao')
    .map((requisito) => {
      const codigo = normalizarCodigoDocumentoCatalogo(requisito.codigo)
      const versaoAtual = requisito.versaoAtual
      const validacaoEstruturalOk = Boolean(
        versaoAtual
        && DOCUMENTOS_COM_VALIDACAO_ESTRUTURAL.has(codigo)
        && ['enviado', 'em_analise', 'aprovado'].includes(versaoAtual.status)
        && !['rejeitado', 'requer_ajuste'].includes(versaoAtual.ultimaAnalise?.resultado || '')
      )
      const satisfacao = resolverSatisfacaoRequisitoParaSubmissao({
        requisitoId: requisito.id,
        tipoDocumento: codigo,
        obrigatorio: requisito.obrigatorio,
        bloqueiaFluxo: requisito.bloqueiaFluxo,
        momento: requisito.momentoObrigatorio,
        regraValidade: requisito.nivelValidacao,
        statusInstancia: requisito.statusInstancia,
        documentoId: requisito.documentoId,
        versaoAprovadaId: requisito.versaoAprovadaId,
        validacaoEstruturalOk,
        versoes: versaoAtual ? [versaoAtual] : [],
      })

      return {
        nome: codigo,
        obrigatorio: requisito.obrigatorio,
        bloqueiaFluxo: requisito.bloqueiaFluxo,
        satisfazSubmissao: satisfacao.satisfazSubmissao,
      }
    })

  return avaliarElegibilidadeSubmissaoNf({
    status: input.notaFiscal.status,
    contexto: {
      cedenteFundoAtivo: input.contexto.cedenteFundoAtivo,
      fundoAtivo: input.contexto.fundoAtivo,
    },
    politica: { publicadaVigente: input.contexto.politicaPublicadaVigente },
    requisitos: {
      instanciados: input.contexto.requisitosInstanciados,
      preCessao: requisitosPreCessao,
      validacaoEstruturalOk: true,
      erroFiscal: null,
    },
    dadosObrigatoriosCompletos: dadosObrigatoriosCompletos(input.notaFiscal),
    operacaoIncompativel: input.contexto.operacaoIncompativel,
  })
}

export function resumoDocumentalDaAvaliacao(
  avaliacao: AvaliacaoElegibilidadeSubmissaoNf,
): ResumoDocumentalListagemNf {
  return {
    elegivel: avaliacao.elegivel,
    totalObrigatorios: avaliacao.obrigatorios.total,
    totalSatisfeitos: avaliacao.obrigatorios.concluidos,
    totalPendentes: avaliacao.obrigatorios.pendentes,
  }
}

export function estadoSubmissaoPorStatus(
  status: NfStatus,
  elegivelRascunho = false,
): EstadoSubmissaoNf {
  if (status === 'rascunho') return elegivelRascunho ? 'pronta_para_submissao' : 'rascunho_incompleto'
  if (status === 'submetida') return 'submetida'
  if (status === 'em_analise') return 'em_analise'
  if (status === 'aprovada') return 'aprovada'
  if (status === 'cancelada') return 'cancelada'
  if (status === 'contestada' || status === 'requer_ajuste') return 'reprovada'
  return 'antecipada'
}

export function normalizarLimiteListagemNf(value: number): LimiteListagemNf {
  return normalizePageSize(value)
}

export function calcularIntervaloPagina(pagina: number, limite: LimiteListagemNf) {
  const { from, to } = buildOffsetRange({
    page: normalizePage(pagina),
    pageSize: limite,
  })

  return {
    inicio: from,
    fim: to,
  }
}

export function normalizarCampoOrdenacaoListagemNf(value: string): CampoOrdenacaoListagemNf {
  return parseSortParams({
    sort: value,
    direction: undefined,
    allowedFields: CAMPOS_ORDENACAO_LISTAGEM_NF,
    defaultField: 'created_at',
  }).field
}
