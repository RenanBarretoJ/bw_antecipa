export const COMUNICACAO_CATEGORIAS = [
  'LOGISTICA_LEMBRETE',
  'LOGISTICA_VENCE_HOJE',
  'LOGISTICA_VENCIDO',
  'LOGISTICA_REJEITADO',
  'FINANCEIRO_LEMBRETE',
  'FINANCEIRO_VENCE_HOJE',
  'FINANCEIRO_VENCIDO',
] as const

export type ComunicacaoCategoria = (typeof COMUNICACAO_CATEGORIAS)[number]
export type ComunicacaoFamilia = 'LOGISTICA' | 'FINANCEIRO'
export type ComunicacaoStatus = 'PENDENTE' | 'PROCESSANDO' | 'ENVIADA' | 'FALHA' | 'BLOQUEADA' | 'CANCELADA'

export type ReguaComunicacao = {
  offsets: number[]
  recorrenciaApos: number
  recorrenciaDias: number
}
export const REGUA_LOGISTICA_PADRAO: ReguaComunicacao = {
  offsets: [-5, -3, -1, 0, 1, 3],
  recorrenciaApos: 3,
  recorrenciaDias: 3,
}

export const REGUA_FINANCEIRA_PADRAO: ReguaComunicacao = {
  offsets: [-7, -3, -1, 0, 1, 3, 5, 7],
  recorrenciaApos: 7,
  recorrenciaDias: 3,
}

export type EtapaRegua = {
  chave: string
  offset: number
  dataObrigacao: string
  dataNominal: string
  dataEfetiva: string
  motivoAjuste: string | null
  recorrente: boolean
}

export type ItemComunicacao = {
  familia: ComunicacaoFamilia
  fundoId: string
  fundoNome: string
  itemKey: string
  entidadeTipo: string
  entidadeId: string | null
  notaFiscalId: string | null
  operacaoId: string | null
  numeroNf: string
  cedenteNome: string
  sacadoNome: string | null
  destinatarioNome: string
  destinatarioEmail: string | null
  dataObrigacao: string
  etapa: EtapaRegua
  categoria: ComunicacaoCategoria
  valor: number | null
  tipoDocumento: string | null
  motivoRejeicao: string | null
  prazoOriginal: string | null
  novaPrevisao: string | null
  linkPortal: string
  rejeicaoVersaoId: string | null
  critico: boolean
}

export type GrupoComunicacao = {
  familia: ComunicacaoFamilia
  fundoId: string
  fundoNome: string
  destinatarioNome: string
  destinatarioEmail: string | null
  dataEfetiva: string
  categoria: ComunicacaoCategoria
  itens: ItemComunicacao[]
}
