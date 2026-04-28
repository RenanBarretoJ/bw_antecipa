// ============================================================
// BW Antecipa - Tipos TypeScript espelhando o schema do banco
// ============================================================

// Enums
export type UserRole = 'gestor' | 'cedente' | 'sacado' | 'consultor'
export type UserStatus = 'ativo' | 'inativo' | 'bloqueado'
export type CedenteStatus = 'pendente' | 'em_analise' | 'ativo' | 'reprovado' | 'bloqueado'
export type DocumentoTipo =
  | 'contrato_social'
  | 'cartao_cnpj'
  | 'rg_cpf'
  | 'comprovante_endereco'
  | 'extrato_bancario'
  | 'balanco_patrimonial'
  | 'dre'
  | 'procuracao'
export type DocumentoStatus = 'aguardando_envio' | 'enviado' | 'em_analise' | 'aprovado' | 'reprovado'
export type ContaEscrowStatus = 'ativa' | 'bloqueada' | 'encerrada'
export type MovimentoTipo = 'credito' | 'debito'
export type NfStatus =
  | 'rascunho'
  | 'submetida'
  | 'em_analise'
  | 'aprovada'
  | 'em_antecipacao'
  | 'liquidada'
  | 'cancelada'
export type OperacaoStatus =
  | 'solicitada'
  | 'em_analise'
  | 'aprovada'
  | 'em_andamento'
  | 'liquidada'
  | 'inadimplente'
  | 'reprovada'
  | 'cancelada'
export type TipoContaBancaria = 'corrente' | 'poupanca'

// Tabelas
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
  habilitar_escrow: boolean
  created_at: string
  updated_at: string
}

export interface Documento {
  id: string
  cedente_id: string
  tipo: DocumentoTipo
  versao: number
  status: DocumentoStatus
  url_arquivo: string | null
  nome_arquivo: string | null
  motivo_reprovacao: string | null
  analisado_por: string | null
  analisado_em: string | null
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
  valor_icms: number
  valor_iss: number
  valor_pis: number
  valor_cofins: number
  valor_ipi: number
  descricao_itens: string | null
  condicao_pagamento: string | null
  arquivo_url: string | null
  status: NfStatus
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

export interface CedenteAcesso {
  id: string
  cedente_id: string
  user_id: string
  perfil: 'administrador' | 'operador'
  ativo: boolean
  convidado_por: string | null
  created_at: string
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

export interface LogAuditoria {
  id: string
  usuario_id: string
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

// Database schema para Supabase client tipado
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Omit<Profile, 'created_at' | 'updated_at'>
        Update: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>
      }
      cedentes: {
        Row: Cedente
        Insert: Omit<Cedente, 'id' | 'created_at' | 'updated_at' | 'status'> & {
          id?: string
          status?: CedenteStatus
        }
        Update: Partial<Omit<Cedente, 'id' | 'created_at' | 'updated_at'>>
      }
      documentos: {
        Row: Documento
        Insert: Omit<Documento, 'id' | 'created_at' | 'updated_at' | 'versao' | 'status'> & {
          id?: string
          versao?: number
          status?: DocumentoStatus
        }
        Update: Partial<Omit<Documento, 'id' | 'created_at' | 'updated_at'>>
      }
      contas_escrow: {
        Row: ContaEscrow
        Insert: Omit<ContaEscrow, 'id' | 'created_at' | 'updated_at' | 'saldo_disponivel' | 'saldo_bloqueado' | 'status'> & {
          id?: string
          saldo_disponivel?: number
          saldo_bloqueado?: number
          status?: ContaEscrowStatus
        }
        Update: Partial<Omit<ContaEscrow, 'id' | 'created_at' | 'updated_at'>>
      }
      movimentos_escrow: {
        Row: MovimentoEscrow
        Insert: Omit<MovimentoEscrow, 'id' | 'created_at'> & { id?: string }
        Update: Partial<Omit<MovimentoEscrow, 'id' | 'created_at'>>
      }
      notas_fiscais: {
        Row: NotaFiscal
        Insert: Omit<NotaFiscal, 'id' | 'created_at' | 'updated_at' | 'status'> & {
          id?: string
          status?: NfStatus
        }
        Update: Partial<Omit<NotaFiscal, 'id' | 'created_at' | 'updated_at'>>
      }
      operacoes: {
        Row: Operacao
        Insert: Omit<Operacao, 'id' | 'created_at' | 'updated_at' | 'status'> & {
          id?: string
          status?: OperacaoStatus
        }
        Update: Partial<Omit<Operacao, 'id' | 'created_at' | 'updated_at'>>
      }
      operacoes_nfs: {
        Row: OperacaoNf
        Insert: OperacaoNf
        Update: Partial<OperacaoNf>
      }
      taxas_cedente: {
        Row: TaxaCedente
        Insert: Omit<TaxaCedente, 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Omit<TaxaCedente, 'id' | 'created_at' | 'updated_at'>>
      }
      cedente_acessos: {
        Row: CedenteAcesso
        Insert: Omit<CedenteAcesso, 'id' | 'created_at'> & { id?: string }
        Update: Partial<Omit<CedenteAcesso, 'id' | 'created_at'>>
      }
      sacados: {
        Row: Sacado
        Insert: Omit<Sacado, 'id' | 'created_at' | 'updated_at'> & { id?: string }
        Update: Partial<Omit<Sacado, 'id' | 'created_at' | 'updated_at'>>
      }
      logs_auditoria: {
        Row: LogAuditoria
        Insert: Omit<LogAuditoria, 'id' | 'created_at'> & { id?: string }
        Update: Partial<Omit<LogAuditoria, 'id' | 'created_at'>>
      }
      notificacoes: {
        Row: Notificacao
        Insert: Omit<Notificacao, 'id' | 'created_at' | 'lida'> & {
          id?: string
          lida?: boolean
        }
        Update: Partial<Omit<Notificacao, 'id' | 'created_at'>>
      }
    }
    Functions: {
      get_user_role: {
        Args: Record<string, never>
        Returns: string
      }
      get_user_cedente_id: {
        Args: Record<string, never>
        Returns: string
      }
      get_user_sacado_cnpj: {
        Args: Record<string, never>
        Returns: string
      }
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
