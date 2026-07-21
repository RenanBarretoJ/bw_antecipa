/**
 * Tipos de domínio já existentes no banco.
 *
 * Não adicionar aqui status multifundo ou logísticos nesta fase. Os valores
 * devem permanecer alinhados ao schema base e às migrations aplicadas.
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
