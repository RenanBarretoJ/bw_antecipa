import type { RlxTipoBase } from './types'

export type RlxFieldKind = 'text' | 'document' | 'date' | 'datetime' | 'decimal'

export interface RlxFieldDefinition {
  aliases: string[]
  kind: RlxFieldKind
  required?: boolean
}

export interface RlxLayoutDefinition {
  fields: Record<string, RlxFieldDefinition>
  totalField: string
  permitsExplicitEmpty: boolean
}

const field = (kind: RlxFieldKind, aliases: string[], required = false): RlxFieldDefinition => ({ kind, aliases, required })

export const RLX_LAYOUTS: Record<RlxTipoBase, RlxLayoutDefinition> = {
  ESTOQUE: {
    permitsExplicitEmpty: false,
    totalField: 'valor_nominal',
    fields: {
      fundo_id: field('text', ['FUNDO_ID']),
      data_referencia: field('date', ['DATA_REFERENCIA'], true),
      id_recebivel: field('text', ['ID_RECEBIVEL', 'ID_TITULO', 'SEU_NUMERO'], true),
      seu_numero: field('text', ['SEU_NUMERO']),
      numero_documento: field('text', ['NU_DOCUMENTO', 'NUMERO_DOCUMENTO', 'DOCUMENTO']),
      tipo_recebivel: field('text', ['TIPO_RECEBIVEL']),
      chave_nfe: field('text', ['CHAVE_NFE', 'CHAVE_NF_E']),
      cedente_nome: field('text', ['NOME_CEDENTE']),
      cedente_documento: field('document', ['DOC_CEDENTE', 'CPF_CNPJ_CEDENTE']),
      sacado_nome: field('text', ['NOME_SACADO']),
      sacado_documento: field('document', ['DOC_SACADO', 'CPF_CNPJ_SACADO']),
      valor_nominal: field('decimal', ['VALOR_NOMINAL'], true),
      valor_presente: field('decimal', ['VALOR_PRESENTE']),
      valor_aquisicao: field('decimal', ['VALOR_AQUISICAO']),
      valor_pdd: field('decimal', ['VALOR_PDD']),
      data_emissao: field('date', ['DATA_EMISSAO']),
      data_vencimento_original: field('date', ['DATA_VENCIMENTO_ORIGINAL', 'DATA_VENCIMENTO']),
      data_aquisicao: field('date', ['DATA_AQUISICAO']),
      situacao_recebivel: field('text', ['SITUACAO_RECEBIVEL', 'STATUS_SNAPSHOT']),
    },
  },
  AQUISICOES: {
    permitsExplicitEmpty: true,
    totalField: 'valor_compra',
    fields: {
      fundo_id: field('text', ['FUNDO_ID']),
      id_recebivel: field('text', ['ID_RECEBIVEL', 'ID_TITULO'], true),
      seu_numero: field('text', ['SEU_NUMERO']),
      numero_documento: field('text', ['NUMERO_DOCUMENTO', 'NU_DOCUMENTO', 'DOCUMENTO']),
      cedente_documento: field('document', ['CPF_CNPJ_CEDENTE', 'IDENTIFICACAO_CEDENTE']),
      sacado_documento: field('document', ['CPF_CNPJ_SACADO', 'IDENTIFICACAO_SACADO']),
      tipo_recebivel: field('text', ['TIPO_RECEBIVEL']),
      chave_nfe: field('text', ['CHAVE_NFE']),
      valor_compra: field('decimal', ['VALOR_COMPRA', 'VALOR_AQUISICAO'], true),
      valor_vencimento: field('decimal', ['VALOR_VENCIMENTO', 'VALOR_NOMINAL']),
      data_movimento: field('date', ['DATA_MOVIMENTO', 'ENTRADA'], true),
      data_vencimento: field('date', ['DATA_VENCIMENTO']),
      codigo_movimento: field('text', ['CODIGO_MOVIMENTO', 'ENTRADA']),
    },
  },
  LIQUIDACOES: {
    permitsExplicitEmpty: true,
    totalField: 'valor_pago',
    fields: {
      fundo_id: field('text', ['FUNDO_ID']),
      id_recebivel: field('text', ['ID_RECEBIVEL', 'ID_TITULO'], true),
      seu_numero: field('text', ['SEU_NUMERO']),
      numero_documento: field('text', ['DOCUMENTO', 'NUMERO_DOCUMENTO', 'NU_DOCUMENTO']),
      cedente_documento: field('document', ['IDENTIFICACAO_CEDENTE', 'CPF_CNPJ_CEDENTE']),
      sacado_documento: field('document', ['IDENTIFICACAO_SACADO', 'CPF_CNPJ_SACADO']),
      tipo_recebivel: field('text', ['TIPO_RECEBIVEL']),
      id_tipo_movimento: field('text', ['ID_TIPO_MOVIMENTO']),
      tipo_movimento: field('text', ['TIPO_MOVIMENTO']),
      status_recebivel: field('text', ['ST_RECEBIVEL', 'STATUS_RECEBIVEL']),
      data_movimento: field('date', ['DATA_MOVIMENTO'], true),
      data_aquisicao: field('date', ['DATA_AQUISICAO']),
      data_vencimento: field('date', ['DATA_VENCIMENTO']),
      valor_aquisicao: field('decimal', ['VL_AQUISICAO', 'VALOR_AQUISICAO']),
      valor_pago: field('decimal', ['VALOR_PAGO'], true),
      valor_nominal: field('decimal', ['VALOR_NOMINAL']),
      juros: field('decimal', ['JUROS']),
    },
  },
  CARTEIRA: {
    permitsExplicitEmpty: false,
    totalField: 'patrimonio_liquido',
    fields: {
      fundo_id: field('text', ['FUNDO_ID'], true),
      data_referencia: field('date', ['DATA_REFERENCIA'], true),
      fundo_externo: field('text', ['FUNDO_EXTERNO', 'NOME_FUNDO']),
      documento_fundo: field('document', ['DOC_FUNDO', 'DOCUMENTO_FUNDO']),
      versao_externa: field('text', ['VERSAO']),
      patrimonio_liquido: field('decimal', ['PATRIMONIO_LIQUIDO', 'PL'], true),
      publicada_externamente_em: field('datetime', ['PUBLICADA_EM']),
    },
  },
}
