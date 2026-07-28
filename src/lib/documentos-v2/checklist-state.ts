import { normalizarCodigoDocumentoCatalogo } from './tipos'
import { DOCUMENTOS_BASE_DA_NF, reconciliarDocumentosBaseComChecklist } from './reconciliacao'

export { DOCUMENTOS_BASE_DA_NF }

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
  documentoId?: string | null
  versaoAprovadaId: string | null
  nivelValidacao?: string | null
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

function instanciaConcluida(instancia: InstanciaChecklistDocumental | undefined) {
  if (!instancia) return false
  if (instancia.versaoAprovadaId) return true
  if (['satisfeito', 'aprovado', 'validado', 'concluido'].includes(instancia.status.toLowerCase())) return true
  const latest = instancia.versoes[0]
  return latest?.status === 'aprovado' || latest?.ultimaAnalise?.resultado === 'aprovado'
}

function instanciaBaseConcluida(instancia: InstanciaChecklistDocumental | undefined) {
  if (!instancia?.documentoId) return false
  if (instancia.versaoAprovadaId) return true
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
  const porRequisito = new Map(input.instancias.map((instancia) => [instancia.requisitoId, instancia]))
  const reconciliacaoBase = reconciliarDocumentosBaseComChecklist({
    requisitos: input.requisitosAplicaveis,
    instancias: input.instancias.map((instancia) => ({
      requisitoId: instancia.requisitoId,
      documentoId: instancia.documentoId,
      versaoAprovadaId: instancia.versaoAprovadaId,
      status: instancia.status,
      versoes: instancia.versoes,
    })),
    documentosBase: Array.from(baseCodes),
  })
  const baseSatisfeitos = new Set(reconciliacaoBase.itens.filter((item) => item.status === 'satisfeito').map((item) => item.requisitoId))
  const requisitos = input.requisitosAplicaveis.filter((requisito) => {
    if (!requisito.ativo) return false
    const codigo = codigoDocumento(requisito)
    if (!baseCodes.has(codigo)) return true
    // A polÃ­tica continua contendo XML/DANFE. Eles sÃ³ deixam o checklist
    // visual depois que uma evidÃªncia-base foi reconciliada.
    return !baseSatisfeitos.has(requisito.id) && !instanciaBaseConcluida(porRequisito.get(requisito.id))
  })

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

  const semInstancia = requisitos.some((requisito) => !porRequisito.has(requisito.id))
  if (semInstancia) {
    const possuiBasePendente = requisitos.some((requisito) => baseCodes.has(codigoDocumento(requisito)))
    return {
      estado: 'nao_instanciado',
      requisitosAplicaveis: requisitos,
      total: requisitos.length,
      concluidos: 0,
      pendentes: requisitos.filter((requisito) => requisito.obrigatorio).length,
      deveExibirCard: possuiBasePendente,
      deveExibirAlerta: true,
      mensagemGestor: 'Há requisitos documentais aplicáveis que ainda não foram gerados para esta nota.',
      mensagemCedente: 'Os requisitos documentais desta nota ainda estão sendo configurados.',
    }
  }

  const requisitoConcluido = (requisito: RequisitoChecklistAplicavel) => {
    if (baseCodes.has(codigoDocumento(requisito))) return baseSatisfeitos.has(requisito.id)
    return instanciaConcluida(porRequisito.get(requisito.id))
  }
  const concluidos = requisitos.filter((requisito) => {
    return requisitoConcluido(requisito)
  }).length
  const pendentes = requisitos.filter((requisito) => requisito.obrigatorio && !requisitoConcluido(requisito)).length
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
