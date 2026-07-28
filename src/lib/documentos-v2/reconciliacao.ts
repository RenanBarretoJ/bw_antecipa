import { normalizarCodigoDocumentoCatalogo } from './tipos'

export const DOCUMENTOS_BASE_DA_NF = ['nf_xml', 'nf_danfe_pdf'] as const

export type ReconciliacaoBaseStatus = 'satisfeito' | 'enviado' | 'pendente'

export interface ReconciliacaoBaseRequisito {
  id: string
  codigo: string
  tipoDocumentoCodigo: string
  ativo: boolean
}

export interface ReconciliacaoBaseInstancia {
  requisitoId: string
  documentoId?: string | null
  versaoAprovadaId?: string | null
  status: string
  nivelValidacao?: string | null
  versoes?: Array<{ status: string }>
}

export interface ResultadoReconciliacaoDocumentosBase {
  instanciasCriadas: number
  instanciasSatisfeitas: number
  instanciasPendentes: number
  divergencias: number
  itens: Array<{ requisitoId: string; codigo: string; status: ReconciliacaoBaseStatus }>
}

function codigoDoRequisito(requisito: Pick<ReconciliacaoBaseRequisito, 'codigo' | 'tipoDocumentoCodigo'>) {
  return normalizarCodigoDocumentoCatalogo(requisito.tipoDocumentoCodigo || requisito.codigo)
}

function evidenciaPersistida(instancia: ReconciliacaoBaseInstancia | undefined) {
  if (!instancia?.documentoId) return false
  if (instancia.versaoAprovadaId) return true
  const latest = instancia.versoes?.[0]
  if (instancia.nivelValidacao === 'estrutural' && ['enviado', 'em_analise'].includes(latest?.status || '')) return true
  return latest?.status === 'aprovado'
}

/**
 * Reconciliacao de dominio usada para separar existencia do requisito,
 * evidencia persistida e satisfacao. A persistencia final ocorre na RPC
 * transacional; esta funcao mantem a mesma regra na leitura e nos testes.
 */
export function reconciliarDocumentosBaseComChecklist(input: {
  requisitos: ReconciliacaoBaseRequisito[]
  instancias: ReconciliacaoBaseInstancia[]
  documentosBase?: readonly string[]
}): ResultadoReconciliacaoDocumentosBase {
  const baseCodes = new Set((input.documentosBase || DOCUMENTOS_BASE_DA_NF).map((codigo) => normalizarCodigoDocumentoCatalogo(codigo)))
  const instancias = new Map(input.instancias.map((instancia) => [instancia.requisitoId, instancia]))
  const itens = input.requisitos
    .filter((requisito) => requisito.ativo && baseCodes.has(codigoDoRequisito(requisito)))
    .map((requisito) => {
      const instancia = instancias.get(requisito.id)
      const codigo = codigoDoRequisito(requisito)
      if (!instancia) return { requisitoId: requisito.id, codigo, status: 'pendente' as const }
      if (!instancia.documentoId) return { requisitoId: requisito.id, codigo, status: 'pendente' as const }
      if (evidenciaPersistida(instancia)) return { requisitoId: requisito.id, codigo, status: 'satisfeito' as const }
      if (instancia.status.toLowerCase() === 'pendente' && (instancia.versoes?.length ?? 0) > 0) {
        return { requisitoId: requisito.id, codigo, status: 'enviado' as const }
      }
      return { requisitoId: requisito.id, codigo, status: 'pendente' as const }
    })

  return {
    instanciasCriadas: 0,
    instanciasSatisfeitas: itens.filter((item) => item.status === 'satisfeito').length,
    instanciasPendentes: itens.filter((item) => item.status === 'pendente' || item.status === 'enviado').length,
    // A leitura pura nao possui o documento vinculado incompatível para
    // classificar divergência; essa contagem é produzida pela RPC SQL.
    divergencias: 0,
    itens,
  }
}
