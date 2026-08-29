import type { PoliticaRequisitoEscopo } from '@/lib/types/domain'

export const ESCOPOS_PRE_CESSAO = ['nf_pre_cessao'] as const
export const ESCOPOS_POS_CESSAO = ['pos_cessao', 'entrega'] as const

export interface RequisitoDocumentalSnapshot {
  codigo: string
  escopo: string
  tipo_documento_codigo: string
  obrigatorio: boolean
  quantidade_minima: number
  formatos_aceitos: string[]
  nivel_validacao: string
  prazo_dias_corridos: number | null
  responsavel_upload: string
  responsavel_aprovacao: string
  ordem: number
  ativo: boolean
}

export function normalizarEscopoDocumental(escopo: string | null | undefined): PoliticaRequisitoEscopo | null {
  if (escopo === 'nf_pre_cessao' || escopo === 'operacao' || escopo === 'pos_cessao' || escopo === 'entrega') return escopo
  return null
}

export function faseDocumentalPorEscopo(escopo: string | null | undefined): 'pre_cessao' | 'pos_cessao' {
  const normalized = normalizarEscopoDocumental(escopo)
  return normalized === 'pos_cessao' || normalized === 'entrega' ? 'pos_cessao' : 'pre_cessao'
}

export function requisitosPosCessaoDoSnapshot(requisitos: readonly RequisitoDocumentalSnapshot[]): RequisitoDocumentalSnapshot[] {
  return requisitos.filter((requisito) => {
    const escopo = normalizarEscopoDocumental(requisito.escopo)
    return requisito.ativo === true && (escopo === 'pos_cessao' || escopo === 'entrega')
  })
}

export function requisitosPreCessaoDoSnapshot(requisitos: readonly RequisitoDocumentalSnapshot[]): RequisitoDocumentalSnapshot[] {
  return requisitos.filter((requisito) => {
    const escopo = normalizarEscopoDocumental(requisito.escopo)
    return requisito.ativo === true && escopo === 'nf_pre_cessao'
  })
}
