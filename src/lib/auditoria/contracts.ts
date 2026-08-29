import type { CursorResult } from '@/lib/pagination/types'

export type AuditoriaListagemItem = {
  id: string
  createdAt: string
  tipo: string
  acao: string
  entidadeTipo: string | null
  entidadeId: string | null
  ator: {
    id: string | null
    nome: string | null
    perfil: string | null
  }
  resumo: string
  origem: string | null
  ipMascarado: string | null
  possuiDetalhes: boolean
}

export type AuditoriaDetalhe = {
  id: string
  dadosAntes: Record<string, unknown> | null
  dadosDepois: Record<string, unknown> | null
}

export type AuditoriaFiltros = {
  q?: string
  tipo?: string
  entidadeTipo?: string
  ator?: string
  dataInicial?: string
  dataFinal?: string
}

export type AuditoriaPagina = CursorResult<AuditoriaListagemItem>
