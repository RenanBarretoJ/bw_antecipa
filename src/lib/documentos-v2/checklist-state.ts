import { normalizarCodigoDocumentoCatalogo } from './tipos'

export const DOCUMENTOS_BASE_DA_NF = ['nf_xml', 'nf_danfe_pdf'] as const

export type EstadoChecklistDocumental =
  | 'nao_aplicavel'
  | 'completo'
  | 'pendente'
  | 'nao_instanciado'
  | 'sem_politica'
  | 'erro'

export interface RequisitoChecklistAplicavel {
  id: string
  codigo: string
  tipoDocumentoCodigo: string
  escopo: string
  obrigatorio: boolean
  ativo: boolean
}

export interface InstanciaChecklistDocumental {
  requisitoId: string
  codigo: string
  obrigatorio: boolean
  status: string
  versaoAprovadaId: string | null
  versoes: Array<{
    status: string
    ultimaAnalise?: { resultado: string } | null
  }>
}

export interface EstadoChecklistDocumentalResolvido {
  estado: EstadoChecklistDocumental
  requisitosAplicaveis: RequisitoChecklistAplicavel[]
  total: number
  concluidos: number
  pendentes: number
  deveExibirCard: boolean
  deveExibirAlerta: boolean
  mensagemGestor?: string
  mensagemCedente?: string
}

function codigoDocumento(requisito: Pick<RequisitoChecklistAplicavel, 'codigo' | 'tipoDocumentoCodigo'>) {
  return normalizarCodigoDocumentoCatalogo(requisito.tipoDocumentoCodigo || requisito.codigo)
}

function instanciaConcluida(instancia: InstanciaChecklistDocumental) {
  if (instancia.versaoAprovadaId) return true
  if (['satisfeito', 'aprovado', 'validado', 'concluido'].includes(instancia.status.toLowerCase())) return true
  const latest = instancia.versoes[0]
  return latest?.status === 'aprovado' || latest?.ultimaAnalise?.resultado === 'aprovado'
}

/**
 * Resolve o estado documental sem transformar uma lista vazia em erro.
 * Requisitos de XML/DANFE são evidências base da própria NF e não entram no
 * checklist complementar exibido nas telas de detalhe.
 */
export function resolverEstadoChecklistDocumental(input: {
  politicaSnapshot: boolean
  requisitosAplicaveis: RequisitoChecklistAplicavel[]
  instancias: InstanciaChecklistDocumental[]
  documentosBaseDaNf?: readonly string[]
}): EstadoChecklistDocumentalResolvido {
  if (!input.politicaSnapshot) {
    return {
      estado: 'sem_politica',
      requisitosAplicaveis: [],
      total: 0,
      concluidos: 0,
      pendentes: 0,
      deveExibirCard: false,
      deveExibirAlerta: true,
      mensagemGestor: 'Não existe política operacional aplicável para esta nota.',
      mensagemCedente: 'Os requisitos documentais desta nota ainda estão sendo configurados.',
    }
  }

  const baseCodes = new Set((input.documentosBaseDaNf || DOCUMENTOS_BASE_DA_NF).map((code) => normalizarCodigoDocumentoCatalogo(code)))
  const requisitos = input.requisitosAplicaveis.filter((requisito) => requisito.ativo && !baseCodes.has(codigoDocumento(requisito)))

  if (requisitos.length === 0) {
    return {
      estado: 'nao_aplicavel',
      requisitosAplicaveis: [],
      total: 0,
      concluidos: 0,
      pendentes: 0,
      deveExibirCard: false,
      deveExibirAlerta: false,
    }
  }

  const porRequisito = new Map(input.instancias.map((instancia) => [instancia.requisitoId, instancia]))
  const semInstancia = requisitos.some((requisito) => !porRequisito.has(requisito.id))
  if (semInstancia) {
    return {
      estado: 'nao_instanciado',
      requisitosAplicaveis: requisitos,
      total: requisitos.length,
      concluidos: 0,
      pendentes: requisitos.filter((requisito) => requisito.obrigatorio).length,
      deveExibirCard: false,
      deveExibirAlerta: true,
      mensagemGestor: 'Há requisitos documentais aplicáveis que ainda não foram gerados para esta nota.',
      mensagemCedente: 'Os requisitos documentais desta nota ainda estão sendo configurados.',
    }
  }

  const concluidos = requisitos.filter((requisito) => {
    const instancia = porRequisito.get(requisito.id)
    return instancia ? instanciaConcluida(instancia) : false
  }).length
  const pendentes = requisitos.filter((requisito) => requisito.obrigatorio && !instanciaConcluida(porRequisito.get(requisito.id)!)).length
  const completo = pendentes === 0

  return {
    estado: completo ? 'completo' : 'pendente',
    requisitosAplicaveis: requisitos,
    total: requisitos.length,
    concluidos,
    pendentes,
    deveExibirCard: true,
    deveExibirAlerta: false,
  }
}
