/**
 * Tipos de domínio já existentes no banco.
 *
 * Os valores devem permanecer alinhados ao schema base e às migrations aplicadas.
 */

export const USER_ROLES = ['gestor', 'cedente', 'sacado', 'consultor'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const USER_STATUSES = ['ativo', 'inativo', 'bloqueado'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export const CEDENTE_STATUSES = ['pendente', 'em_analise', 'ativo', 'reprovado', 'bloqueado'] as const
export type CedenteStatus = (typeof CEDENTE_STATUSES)[number]

export const DOCUMENT_TYPES = [
  'contrato_social',
  'cartao_cnpj',
  'rg_cpf',
  'comprovante_endereco',
  'extrato_bancario',
  'balanco_patrimonial',
  'dre',
  'procuracao',
  'comprovante_de_renda',
] as const
export type DocumentoTipo = (typeof DOCUMENT_TYPES)[number]

export const DOCUMENT_STATUSES = ['aguardando_envio', 'enviado', 'em_analise', 'aprovado', 'reprovado'] as const
export type DocumentoStatus = (typeof DOCUMENT_STATUSES)[number]

export const ESCROW_STATUSES = ['ativa', 'bloqueada', 'encerrada'] as const
export type ContaEscrowStatus = (typeof ESCROW_STATUSES)[number]

export const MOVEMENT_TYPES = ['credito', 'debito'] as const
export type MovimentoTipo = (typeof MOVEMENT_TYPES)[number]

export const NF_STATUSES = [
  'rascunho',
  'submetida',
  'em_analise',
  'aprovada',
  'em_antecipacao',
  'aceita',
  'contestada',
  'liquidada',
  'cancelada',
  'requer_ajuste',
] as const
export type NfStatus = (typeof NF_STATUSES)[number]

export const OPERACAO_STATUSES = [
  'solicitada',
  'em_analise',
  'aprovada',
  'em_andamento',
  'liquidada',
  'inadimplente',
  'reprovada',
  'cancelada',
] as const
export type OperacaoStatus = (typeof OPERACAO_STATUSES)[number]

export const BANK_ACCOUNT_TYPES = ['corrente', 'poupanca'] as const
export type TipoContaBancaria = (typeof BANK_ACCOUNT_TYPES)[number]

export const CEDENTE_ACCESS_PROFILES = ['administrador', 'operador'] as const
export type CedenteAcessoPerfil = (typeof CEDENTE_ACCESS_PROFILES)[number]

export const ALTERATION_REQUEST_STATUSES = ['pendente', 'aprovada', 'reprovada'] as const
export type SolicitacaoAlteracaoStatus = (typeof ALTERATION_REQUEST_STATUSES)[number]

export const CEDENTE_FUNDO_STATUSES = ['ativo', 'suspenso', 'encerrado'] as const
export type CedenteFundoStatus = (typeof CEDENTE_FUNDO_STATUSES)[number]

export const POLITICA_STATUSES = ['rascunho', 'ativa', 'desativada'] as const
export type PoliticaStatus = (typeof POLITICA_STATUSES)[number]

export const POLICY_REQUIREMENT_SCOPES = ['nf_pre_cessao', 'operacao', 'pos_cessao', 'entrega'] as const
export type PoliticaRequisitoEscopo = (typeof POLICY_REQUIREMENT_SCOPES)[number]

export const POLICY_VALIDATION_LEVELS = ['estrutural', 'manual', 'hibrido'] as const
export type PoliticaNivelValidacao = (typeof POLICY_VALIDATION_LEVELS)[number]

export const POLICY_RESPONSIBLES = ['cedente', 'gestor', 'sacado', 'sistema'] as const
export type PoliticaResponsavel = (typeof POLICY_RESPONSIBLES)[number]

export const POLICY_DOCUMENT_CODES = [
  'nf_xml',
  'nf_danfe_pdf',
  'nf_pedido_compra',
  'cte',
  'canhoto',
] as const
export type PoliticaTipoDocumentoCodigo = (typeof POLICY_DOCUMENT_CODES)[number]

export const REPOSITORY_DOCUMENT_STATUSES = ['pendente', 'enviado', 'em_analise', 'aprovado', 'rejeitado', 'substituido', 'cancelado'] as const
export type RepositorioDocumentoStatus = (typeof REPOSITORY_DOCUMENT_STATUSES)[number]

export const DOCUMENT_VERSION_STATUSES = ['enviado', 'em_analise', 'aprovado', 'rejeitado', 'substituido', 'cancelado'] as const
export type DocumentoVersaoStatus = (typeof DOCUMENT_VERSION_STATUSES)[number]

export const REQUIREMENT_INSTANCE_STATUSES = ['pendente', 'satisfeito', 'vencido', 'dispensado', 'cancelado'] as const
export type RequisitoDocumentoStatus = (typeof REQUIREMENT_INSTANCE_STATUSES)[number]

export const DOCUMENT_ANALYSIS_RESULTS = ['aprovado', 'rejeitado', 'pendente', 'requer_ajuste'] as const
export type DocumentoAnaliseResultado = (typeof DOCUMENT_ANALYSIS_RESULTS)[number]

export const CONTEXT_CONFIGURATION_STATUSES = ['completo', 'legado_inferido', 'legado_indefinido'] as const
export type ContextoConfiguracaoStatus = (typeof CONTEXT_CONFIGURATION_STATUSES)[number]

export const ACCEPTANCE_STATUSES = ['pendente', 'aceito', 'contestado', 'dispensado'] as const
export type AceiteSacadoStatus = (typeof ACCEPTANCE_STATUSES)[number]

export const AUDIT_ACTOR_TYPES = ['usuario', 'sistema', 'integracao', 'cron'] as const
export type AuditoriaAtorTipo = (typeof AUDIT_ACTOR_TYPES)[number]

export type AuditOrigin = string

export type ContratoDocumentType =
  | 'contrato'
  | 'contrato_assinado'
  | 'termo'
  | 'termo_assinado'
  | 'notificacao'
  | 'notificacao_assinada'
  | 'comprovante_pagamento'
  | 'remessa'
  | 'quitacao'
  | 'quitacao_assinada'

export type ContratoEntityType = 'cedente' | 'operacao'
