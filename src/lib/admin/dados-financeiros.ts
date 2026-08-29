import type { CompletudeImportacaoFinanceira, TipoBaseFinanceiro } from '@/lib/financeiro/ingestao/types'

export interface AdminImportacaoFinanceira {
  id: string
  tipo_base: TipoBaseFinanceiro
  data_referencia: string
  provedor: string
  origem: 'MANUAL' | 'CRON' | 'GOLDEN_DATASET'
  integracao_fundo_versao_id: string | null
  fonte: string
  layout_nome: string
  versao_layout: string
  status: string
  completude: CompletudeImportacaoFinanceira
  nome_arquivo: string | null
  hash_conteudo: string
  encoding_detectado: string
  linhas_total: number
  linhas_validas: number
  linhas_invalidas: number
  linhas_warning: number
  linhas_publicadas: number
  valor_total: string | number | null
  erros: unknown[]
  recebida_em: string
  publicada_em: string | null
  substitui_importacao_id: string | null
  declaracao_sem_movimento: boolean
  amostras_linhas: Array<{
    numero_linha: number
    status: string
    erros: unknown[]
    avisos: unknown[]
  }>
}

export interface AdminDadosFinanceirosFundo {
  fundoId: string
  importacoes: AdminImportacaoFinanceira[]
  vigentes: Partial<Record<TipoBaseFinanceiro, AdminImportacaoFinanceira>>
}
