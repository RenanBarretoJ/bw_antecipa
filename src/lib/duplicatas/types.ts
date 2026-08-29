export type TipoAtivoFinanceiro = 'NOTA_FISCAL' | 'DUPLICATA_MERCANTIL'
export type StatusDuplicata = 'RASCUNHO' | 'EXTRAIDA' | 'REVISAR' | 'VALIDADA' | 'REJEITADA'
export type MetodoExtracaoDuplicata = 'AUTOMATICA' | 'MANUAL'
export type ResultadoConfrontoDuplicata = 'COERENTE' | 'DIVERGENTE' | 'INCOMPLETO'
export type NivelValidacaoDuplicata = 'blocking' | 'warning' | 'info'

export const CAMPOS_DUPLICATA = [
  'numero',
  'numero_fatura',
  'parcela',
  'data_emissao',
  'data_vencimento',
  'valor_nominal',
  'nome_cedente_documento',
  'cnpj_cedente_documento',
  'nome_sacado_documento',
  'cnpj_sacado_documento',
  'local_pagamento',
  'aceite_textual',
  'aceite_detectado_textualmente',
] as const

export type CampoDuplicata = (typeof CAMPOS_DUPLICATA)[number]

export interface EvidenciaExtracaoDuplicata {
  campo: CampoDuplicata
  valorOriginal: string
  valorNormalizado: string | number | null
  trechoFonte: string
  metodo: 'rotulo' | 'secao' | 'padrao_estrutural' | 'manual'
  confianca: number
}

export interface CamposDuplicata {
  numero: string | null
  numero_fatura: string | null
  parcela: string
  data_emissao: string | null
  data_vencimento: string | null
  valor_nominal: number | null
  nome_cedente_documento: string | null
  cnpj_cedente_documento: string | null
  nome_sacado_documento: string | null
  cnpj_sacado_documento: string | null
  local_pagamento: string | null
  aceite_textual: string | null
  aceite_detectado_textualmente: 'SIM' | 'NAO' | 'INDETERMINADO'
}

export interface ExtracaoDuplicata {
  campos: CamposDuplicata
  evidencias: Partial<Record<CampoDuplicata, EvidenciaExtracaoDuplicata>>
  confiancaGeral: number
  camposCriticosPendentes: CampoDuplicata[]
  metodo: MetodoExtracaoDuplicata
  textoExtraido: string | null
}

export interface NotaFiscalParaConfronto {
  id: string
  fundo_id: string | null
  cedente_fundo_id: string | null
  cedente_id: string
  numero_nf: string
  data_emissao: string
  data_vencimento: string
  cnpj_emitente: string
  cnpj_destinatario: string
  razao_social_emitente?: string
  razao_social_destinatario?: string
  valor_bruto: number
}

export interface ItemValidacaoDuplicata {
  campo: string
  nivel: NivelValidacaoDuplicata
  codigo: string
  mensagem: string
  valorDuplicata?: string | number | null
  valorNotaFiscal?: string | number | null
}

export interface ResultadoValidacaoDuplicata {
  resultado: ResultadoConfrontoDuplicata
  bloqueios: ItemValidacaoDuplicata[]
  avisos: ItemValidacaoDuplicata[]
  informacoes: ItemValidacaoDuplicata[]
}

export interface AgregadoDuplicatasNota {
  resultado: ResultadoConfrontoDuplicata
  valorNominalTotal: number
  valorNotaFiscal: number
  diferenca: number
  quantidade: number
  quantidadeIncompleta: number
}

export interface DuplicataRegistro extends CamposDuplicata {
  id: string
  fundo_id: string
  cedente_fundo_id: string
  cedente_id: string
  nota_fiscal_id: string
  sacado_id: string | null
  moeda: string
  status_validacao: StatusDuplicata
  metodo_extracao: MetodoExtracaoDuplicata
  resultado_confronto: ResultadoConfrontoDuplicata
  versao_atual_id: string | null
  criado_por: string
  validado_por: string | null
  validado_em: string | null
  motivo_rejeicao: string | null
  created_at: string
  updated_at: string
}

export interface DuplicataVersaoRegistro {
  id: string
  duplicata_id: string
  nota_fiscal_id: string
  numero_versao: number
  bucket: string
  path: string
  nome_original: string
  mime_type: string
  tamanho_bytes: number
  sha256: string
  metodo_extracao: MetodoExtracaoDuplicata
  texto_extraido: string | null
  campos_extraidos: Record<string, unknown>
  evidencias: Record<string, unknown>
  resultado_validacao: ResultadoValidacaoDuplicata | Record<string, unknown>
  confianca_geral: number
  enviado_por: string
  enviado_em: string
  created_at: string
}

export interface DuplicataCorrecaoRegistro {
  id: string
  duplicata_id: string
  duplicata_versao_id: string
  campo: CampoDuplicata
  valor_original: unknown
  valor_corrigido: unknown
  motivo: string
  corrigido_por: string
  corrigido_em: string
}

export interface DuplicataValidacaoRegistro {
  id: string
  duplicata_id: string
  duplicata_versao_id: string
  resultado: 'VALIDADA' | 'REJEITADA'
  observacoes: string | null
  resultado_confronto: Record<string, unknown>
  validado_por: string
  validado_em: string
}
