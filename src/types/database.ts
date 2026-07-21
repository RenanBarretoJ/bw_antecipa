// Tipos do estado atual do banco: schema base + migrations 003 a 016.
// Não incluir aqui modelos da Fase 2 ou status logísticos.

export type {
  AuditoriaAtorTipo,
  AuditOrigin,
  ContaEscrowStatus,
  CedenteAcessoPerfil,
  CedenteStatus,
  DocumentoStatus,
  DocumentoTipo,
  MovimentoTipo,
  NfStatus,
  OperacaoStatus,
  SolicitacaoAlteracaoStatus,
  TipoContaBancaria,
  UserRole,
  UserStatus,
} from '@/lib/types/domain'

import type {
  AuditoriaAtorTipo,
  CedenteAcessoPerfil,
  CedenteStatus,
  ContaEscrowStatus,
  DocumentoStatus,
  DocumentoTipo,
  MovimentoTipo,
  NfStatus,
  OperacaoStatus,
  SolicitacaoAlteracaoStatus,
  TipoContaBancaria,
  UserRole,
  UserStatus,
} from '@/lib/types/domain'

type InsertShape<Row, RequiredKeys extends keyof Row = never> = Partial<Row> & Pick<Row, RequiredKeys>
type UpdateShape<Row> = Partial<Omit<Row, 'id' | 'created_at' | 'updated_at'>>

export interface Profile {
  id: string
  role: UserRole
  nome_completo: string
  email: string
  telefone: string | null
  status: UserStatus
  created_at: string
  updated_at: string
}

export interface Cedente {
  id: string
  user_id: string
  cnpj: string
  razao_social: string
  nome_fantasia: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  estado: string | null
  telefone_comercial: string | null
  email_comercial: string | null
  cnae: string | null
  nome_representante: string | null
  cpf_representante: string | null
  rg_representante: string | null
  cargo_representante: string | null
  email_representante: string | null
  telefone_representante: string | null
  banco: string | null
  agencia: string | null
  conta: string | null
  tipo_conta: TipoContaBancaria | null
  status: CedenteStatus
  fundo_id: string | null
  sacado_razao_social: string | null
  sacado_cnpj: string | null
  sacado_descricao: string | null
  sacado_banco_escrow: string | null
  sacado_conta_escrow: string | null
  sacado_agencia_escrow: string | null
  sacado_tipo_conta_escrow: string | null
  contrato_url: string | null
  contrato_gerado_em: string | null
  testemunha_1_nome: string | null
  testemunha_1_cpf: string | null
  testemunha_2_nome: string | null
  testemunha_2_cpf: string | null
  contrato_assinado_url: string | null
  habilitar_escrow: boolean
  coobrigacao: boolean
  created_at: string
  updated_at: string
}

export interface Representante {
  id: string
  cedente_id: string
  nome: string
  cpf: string
  rg: string
  cargo: string
  email: string
  telefone: string
  principal: boolean
  created_at: string
  updated_at: string
}

export interface Documento {
  id: string
  cedente_id: string
  representante_id: string | null
  tipo: DocumentoTipo
  versao: number
  status: DocumentoStatus
  url_arquivo: string | null
  nome_arquivo: string | null
  motivo_reprovacao: string | null
  analisado_por: string | null
  analisado_em: string | null
  atualizacao_solicitada_em: string | null
  atualizacao_solicitada_por: string | null
  created_at: string
  updated_at: string
}

export interface ContaEscrow {
  id: string
  cedente_id: string
  identificador: string
  saldo_disponivel: number
  saldo_bloqueado: number
  status: ContaEscrowStatus
  created_at: string
  updated_at: string
}

export interface MovimentoEscrow {
  id: string
  conta_escrow_id: string
  tipo: MovimentoTipo
  descricao: string
  valor: number
  saldo_apos: number
  operacao_id: string | null
  created_at: string
}

export interface Fundo {
  id: string
  nome: string
  cnpj: string
  administradora_nome: string
  administradora_cnpj: string
  gestora_nome: string
  gestora_cnpj: string
  custodiante_nome: string | null
  custodiante_cnpj: string | null
  conta_vinculada: string | null
  agencia: string | null
  banco: string | null
  administradora_endereco: string | null
  administradora_ato_declaratorio: string | null
  contato_nome: string | null
  contato_email: string | null
  ativo: boolean | null
  created_at: string | null
}

export interface DevedorSolidario {
  id: string
  cedente_id: string
  nome: string
  nacionalidade: string | null
  estado_civil: string | null
  profissao: string | null
  data_nascimento: string | null
  doc_tipo: string | null
  doc_numero: string
  doc_expedidor: string | null
  doc_data: string | null
  cpf: string
  endereco: string | null
  telefone: string | null
  email: string | null
  ordem: number | null
  created_at: string | null
}

export interface NotaFiscal {
  id: string
  cedente_id: string
  numero_nf: string
  serie: string | null
  chave_acesso: string | null
  data_emissao: string
  data_vencimento: string
  cnpj_emitente: string
  razao_social_emitente: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  valor_liquido: number | null
  valor_icms: number | null
  valor_iss: number | null
  valor_pis: number | null
  valor_cofins: number | null
  valor_ipi: number | null
  descricao_itens: string | null
  condicao_pagamento: string | null
  arquivo_url: string | null
  status: NfStatus
  pedido_sap: string | null
  status_sap: string | null
  taxa_desagio: number | null
  valor_antecipado: number | null
  aprovacao_sacado_em: string | null
  aprovada_gestor_em: string | null
  motivo_ajuste: string | null
  created_at: string
  updated_at: string
}

export interface Operacao {
  id: string
  cedente_id: string
  conta_escrow_id: string | null
  valor_bruto_total: number
  taxa_desconto: number
  prazo_dias: number
  valor_liquido_desembolso: number
  data_vencimento: string
  status: OperacaoStatus
  aprovado_por: string | null
  aprovado_em: string | null
  motivo_reprovacao: string | null
  termo_url: string | null
  termo_gerado_em: string | null
  taxa_desagio: number | null
  valor_face_total: number | null
  preco_aquisicao: number | null
  testemunha_1_id: string | null
  testemunha_2_id: string | null
  termo_assinado_url: string | null
  comprovante_pagamento_url: string | null
  notificacao_url: string | null
  notificacao_gerado_em: string | null
  notificacao_assinada_url: string | null
  remessa_url: string | null
  remessa_gerado_em: string | null
  remessa_enviado_em: string | null
  remessa_fromtis_id: string | null
  remessa_fromtis_retorno: string | null
  liquidada_em: string | null
  quitacao_url: string | null
  quitacao_gerado_em: string | null
  quitacao_assinada_url: string | null
  created_at: string
  updated_at: string
}

export interface OperacaoNf {
  operacao_id: string
  nota_fiscal_id: string
}

export interface TaxaCedente {
  id: string
  cedente_id: string
  prazo_min: number
  prazo_max: number
  taxa_percentual: number
  created_at: string
  updated_at: string
}

export interface ConsultorCedente {
  id: string
  consultor_id: string
  cedente_id: string
  comissao_percentual: number
  created_at: string
}

export interface Sacado {
  id: string
  user_id: string
  cnpj: string
  razao_social: string
  email: string | null
  created_at: string
  updated_at: string
}

export interface Testemunha {
  id: string
  nome: string
  cpf: string
  email: string | null
  ativo: boolean
  created_at: string
}

export interface SolicitacaoAlteracaoCedente {
  id: string
  cedente_id: string
  dados_atuais: Record<string, unknown>
  dados_propostos: Record<string, unknown>
  representantes_atuais: unknown[]
  representantes_propostos: unknown[]
  status: SolicitacaoAlteracaoStatus
  motivo_reprovacao: string | null
  solicitado_em: string
  analisado_por: string | null
  analisado_em: string | null
}

export interface CedenteAcesso {
  id: string
  cedente_id: string
  user_id: string
  perfil: CedenteAcessoPerfil
  ativo: boolean
  convidado_por: string | null
  created_at: string
}

export interface LogAuditoria {
  id: string
  usuario_id: string | null
  ator_tipo: AuditoriaAtorTipo
  origem: string
  ator_identificador: string | null
  tipo_evento: string
  entidade_tipo: string
  entidade_id: string | null
  dados_antes: Record<string, unknown> | null
  dados_depois: Record<string, unknown> | null
  ip_origem: string | null
  created_at: string
}

export interface Notificacao {
  id: string
  usuario_id: string
  titulo: string
  mensagem: string
  tipo: string
  lida: boolean
  created_at: string
}

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile & Record<string, unknown>; Insert: InsertShape<Profile, 'id' | 'nome_completo' | 'email'> & Record<string, unknown>; Update: UpdateShape<Profile> & Record<string, unknown>; Relationships: [] }
      cedentes: { Row: Cedente & Record<string, unknown>; Insert: InsertShape<Cedente, 'user_id' | 'cnpj' | 'razao_social'> & Record<string, unknown>; Update: UpdateShape<Cedente> & Record<string, unknown>; Relationships: [] }
      representantes: { Row: Representante & Record<string, unknown>; Insert: InsertShape<Representante, 'cedente_id' | 'nome' | 'cpf' | 'rg' | 'cargo' | 'email' | 'telefone'> & Record<string, unknown>; Update: UpdateShape<Representante> & Record<string, unknown>; Relationships: [] }
      documentos: { Row: Documento & Record<string, unknown>; Insert: InsertShape<Documento, 'cedente_id' | 'tipo'> & Record<string, unknown>; Update: UpdateShape<Documento> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'documentos_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }, { foreignKeyName: 'documentos_representante_id_fkey'; columns: ['representante_id']; isOneToOne: false; referencedRelation: 'representantes'; referencedColumns: ['id'] }, { foreignKeyName: 'documentos_analisado_por_fkey'; columns: ['analisado_por']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      contas_escrow: { Row: ContaEscrow & Record<string, unknown>; Insert: InsertShape<ContaEscrow, 'cedente_id' | 'identificador'> & Record<string, unknown>; Update: UpdateShape<ContaEscrow> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'contas_escrow_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      movimentos_escrow: { Row: MovimentoEscrow & Record<string, unknown>; Insert: InsertShape<MovimentoEscrow, 'conta_escrow_id' | 'tipo' | 'descricao' | 'valor' | 'saldo_apos'> & Record<string, unknown>; Update: UpdateShape<MovimentoEscrow> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'movimentos_escrow_conta_escrow_id_fkey'; columns: ['conta_escrow_id']; isOneToOne: false; referencedRelation: 'contas_escrow'; referencedColumns: ['id'] }, { foreignKeyName: 'fk_movimentos_operacao'; columns: ['operacao_id']; isOneToOne: false; referencedRelation: 'operacoes'; referencedColumns: ['id'] }] }
      fundos: { Row: Fundo & Record<string, unknown>; Insert: InsertShape<Fundo, 'nome' | 'cnpj' | 'administradora_nome' | 'administradora_cnpj'> & Record<string, unknown>; Update: UpdateShape<Fundo> & Record<string, unknown>; Relationships: [] }
      devedores_solidarios: { Row: DevedorSolidario & Record<string, unknown>; Insert: InsertShape<DevedorSolidario, 'cedente_id' | 'nome' | 'doc_numero' | 'cpf'> & Record<string, unknown>; Update: UpdateShape<DevedorSolidario> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'devedores_solidarios_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      notas_fiscais: { Row: NotaFiscal & Record<string, unknown>; Insert: InsertShape<NotaFiscal, 'cedente_id' | 'numero_nf' | 'data_emissao' | 'data_vencimento' | 'cnpj_emitente' | 'razao_social_emitente' | 'cnpj_destinatario' | 'razao_social_destinatario' | 'valor_bruto'> & Record<string, unknown>; Update: UpdateShape<NotaFiscal> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'notas_fiscais_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      operacoes: { Row: Operacao & Record<string, unknown>; Insert: InsertShape<Operacao, 'cedente_id' | 'valor_bruto_total' | 'taxa_desconto' | 'prazo_dias' | 'valor_liquido_desembolso' | 'data_vencimento'> & Record<string, unknown>; Update: UpdateShape<Operacao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'operacoes_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_conta_escrow_id_fkey'; columns: ['conta_escrow_id']; isOneToOne: false; referencedRelation: 'contas_escrow'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_aprovado_por_fkey'; columns: ['aprovado_por']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_testemunha_1_id_fkey'; columns: ['testemunha_1_id']; isOneToOne: false; referencedRelation: 'testemunhas'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_testemunha_2_id_fkey'; columns: ['testemunha_2_id']; isOneToOne: false; referencedRelation: 'testemunhas'; referencedColumns: ['id'] }] }
      operacoes_nfs: { Row: OperacaoNf & Record<string, unknown>; Insert: OperacaoNf & Record<string, unknown>; Update: Partial<OperacaoNf> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'operacoes_nfs_operacao_id_fkey'; columns: ['operacao_id']; isOneToOne: false; referencedRelation: 'operacoes'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_nfs_nota_fiscal_id_fkey'; columns: ['nota_fiscal_id']; isOneToOne: false; referencedRelation: 'notas_fiscais'; referencedColumns: ['id'] }] }
      taxas_cedente: { Row: TaxaCedente & Record<string, unknown>; Insert: InsertShape<TaxaCedente, 'cedente_id' | 'prazo_min' | 'prazo_max' | 'taxa_percentual'> & Record<string, unknown>; Update: UpdateShape<TaxaCedente> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'taxas_cedente_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      consultor_cedente: { Row: ConsultorCedente & Record<string, unknown>; Insert: InsertShape<ConsultorCedente, 'consultor_id' | 'cedente_id'> & Record<string, unknown>; Update: UpdateShape<ConsultorCedente> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'consultor_cedente_consultor_id_fkey'; columns: ['consultor_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }, { foreignKeyName: 'consultor_cedente_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      sacados: { Row: Sacado & Record<string, unknown>; Insert: InsertShape<Sacado, 'user_id' | 'cnpj' | 'razao_social'> & Record<string, unknown>; Update: UpdateShape<Sacado> & Record<string, unknown>; Relationships: [] }
      testemunhas: { Row: Testemunha & Record<string, unknown>; Insert: InsertShape<Testemunha, 'nome' | 'cpf'> & Record<string, unknown>; Update: UpdateShape<Testemunha> & Record<string, unknown>; Relationships: [] }
      solicitacoes_alteracao_cedente: { Row: SolicitacaoAlteracaoCedente & Record<string, unknown>; Insert: InsertShape<SolicitacaoAlteracaoCedente, 'cedente_id' | 'dados_atuais' | 'dados_propostos'> & Record<string, unknown>; Update: UpdateShape<SolicitacaoAlteracaoCedente> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'solicitacoes_alteracao_cedente_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      cedente_acessos: { Row: CedenteAcesso & Record<string, unknown>; Insert: InsertShape<CedenteAcesso, 'cedente_id' | 'user_id'> & Record<string, unknown>; Update: UpdateShape<CedenteAcesso> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'cedente_acessos_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }, { foreignKeyName: 'cedente_acessos_user_id_fkey'; columns: ['user_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      logs_auditoria: { Row: LogAuditoria & Record<string, unknown>; Insert: InsertShape<LogAuditoria, 'tipo_evento' | 'entidade_tipo' | 'ator_tipo' | 'origem'> & Record<string, unknown>; Update: UpdateShape<LogAuditoria> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'logs_auditoria_usuario_id_fkey'; columns: ['usuario_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      notificacoes: { Row: Notificacao & Record<string, unknown>; Insert: InsertShape<Notificacao, 'usuario_id' | 'titulo' | 'mensagem' | 'tipo'> & Record<string, unknown>; Update: UpdateShape<Notificacao> & Record<string, unknown>; Relationships: [] }
    }
    Views: Record<string, never>
    Functions: {
      get_user_role: { Args: Record<string, never>; Returns: string }
      get_user_cedente_id: { Args: Record<string, never>; Returns: string | null }
      get_user_sacado_cnpj: { Args: Record<string, never>; Returns: string | null }
      get_user_operacao_ids: { Args: Record<string, never>; Returns: string[] }
    }
    Enums: {
      user_role: UserRole
      user_status: UserStatus
      cedente_status: CedenteStatus
      documento_tipo: DocumentoTipo
      documento_status: DocumentoStatus
      conta_escrow_status: ContaEscrowStatus
      movimento_tipo: MovimentoTipo
      nf_status: NfStatus
      operacao_status: OperacaoStatus
      tipo_conta_bancaria: TipoContaBancaria
    }
  }
}
