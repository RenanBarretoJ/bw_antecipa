import { z } from 'zod'
import type { UserRole, UserStatus } from '@/types/database'

export const ADMIN_USUARIO_PAGE_SIZES = [20, 50, 100] as const
export const ADMIN_USUARIO_STATUS = ['todos', 'ativos', 'inativos'] as const
export const ADMIN_USUARIO_PAPEIS = ['todos', 'gestor', 'super_admin', 'cedente', 'consultor', 'sacado'] as const
export const ADMIN_USUARIO_SUPER_ADMIN = ['todos', 'sim', 'nao'] as const
export const ADMIN_USUARIO_TIPOS_CONVITE = ['gestor', 'super_admin'] as const

export type AdminUsuarioPageSize = typeof ADMIN_USUARIO_PAGE_SIZES[number]
export type AdminUsuarioStatusFilter = typeof ADMIN_USUARIO_STATUS[number]
export type AdminUsuarioPapelFilter = typeof ADMIN_USUARIO_PAPEIS[number]
export type AdminUsuarioSuperAdminFilter = typeof ADMIN_USUARIO_SUPER_ADMIN[number]
export type AdminUsuarioTipoConvite = typeof ADMIN_USUARIO_TIPOS_CONVITE[number]

export const adminUsuarioConviteSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.').max(160, 'Nome muito longo.'),
  email: z.string().trim().toLowerCase().pipe(z.email('Informe um e-mail valido.')),
  tipo: z.enum(ADMIN_USUARIO_TIPOS_CONVITE),
  fundoIds: z.array(z.uuid()).max(100),
}).superRefine((value, context) => {
  if (value.tipo === 'super_admin' && value.fundoIds.length > 0) {
    context.addIssue({ code: 'custom', path: ['fundoIds'], message: 'Super Admin puro nao recebe fundos operacionais.' })
  }
})

export type AdminUsuarioResumo = {
  total: number
  ativos: number
  inativos: number
  gestores: number
  super_admins: number
}

export type AdminUsuarioListItem = {
  id: string
  nome_completo: string
  email: string
  papel_primario: UserRole
  status: UserStatus
  super_admin: boolean
  fundos_ativos: number
  mfa_configurado: boolean
  created_at: string
}

export type AdminUsuarioListResult = {
  itens: AdminUsuarioListItem[]
  total: number
  pagina: number
  por_pagina: AdminUsuarioPageSize
  total_paginas: number
}

export type AdminUsuarioDetalhe = {
  id: string
  nome_completo: string
  email: string
  papel_primario: UserRole
  status: UserStatus
  capacidades: UserRole[]
  super_admin: boolean
  mfa_configurado: boolean
  mfa_reset_em: string | null
  sessoes_revogadas_em: string | null
  created_at: string
  updated_at: string
}

export type AdminUsuarioFundo = {
  fundo_id: string
  fundo_nome: string
  fundo_cnpj: string
  fundo_ativo: boolean
  vinculo_id: string | null
  vinculo_status: 'ativo' | 'suspenso' | 'revogado' | null
  principal: boolean
  updated_at: string | null
}

export type AdminFundoGestor = {
  usuario_id: string
  nome_completo: string
  email: string
  usuario_status: UserStatus
  super_admin: boolean
  vinculo_id: string | null
  vinculo_status: 'ativo' | 'suspenso' | 'revogado' | null
  updated_at: string | null
}

export const ADMIN_VINCULO_BUSCA_DIRECOES = ['gestores_para_fundo', 'fundos_para_gestor'] as const
export type AdminVinculoBuscaDirecao = typeof ADMIN_VINCULO_BUSCA_DIRECOES[number]

export const adminVinculoBuscaSchema = z.object({
  direcao: z.enum(ADMIN_VINCULO_BUSCA_DIRECOES),
  contextoId: z.uuid(),
  busca: z.string().trim().min(2).max(120),
  pagina: z.number().int().min(1),
})

export type AdminVinculoBuscaItem = {
  id: string
  nome: string
  descricao: string
  entidade_status: 'ativo' | 'inativo' | 'bloqueado'
  vinculo_status: 'suspenso' | 'revogado' | null
}

export type AdminVinculoBuscaResult = {
  itens: AdminVinculoBuscaItem[]
  total: number
  pagina: number
  por_pagina: 20
  total_paginas: number
}

export type AdminVinculoBuscaActionResult = {
  success: boolean
  message?: string
  data?: AdminVinculoBuscaResult
}

export type AdminUsuarioAuditoriaItem = {
  id: string
  tipo_evento: string
  ator_usuario_id: string | null
  ator_nome: string | null
  origem: string
  correlation_id: string | null
  dados: Record<string, unknown>
  created_at: string
}

export type AdminUsuarioActionResult = {
  success: boolean
  message: string
  data?: { id: string; existente?: boolean }
  fieldErrors?: Record<string, string[]>
  notification?: { type: 'success' | 'error' | 'warning'; message: string; details?: string }
}

export type AdminConviteGestorPreparado = {
  convite_id: string
  status: 'PENDENTE'
  fundos: Array<{ id: string; nome: string }>
}

export type AdminConviteGestorEstado = {
  id: string
  status: 'PENDENTE' | 'ACEITO' | 'EXPIRADO' | 'CANCELADO'
  expires_at: string
}

export function parseAdminUsuarioFilters(input: Record<string, string | string[] | undefined>) {
  const busca = typeof input.busca === 'string' ? input.busca.trim().slice(0, 120) : ''
  const papel = ADMIN_USUARIO_PAPEIS.includes(input.papel as AdminUsuarioPapelFilter)
    ? input.papel as AdminUsuarioPapelFilter
    : 'todos'
  const status = ADMIN_USUARIO_STATUS.includes(input.status as AdminUsuarioStatusFilter)
    ? input.status as AdminUsuarioStatusFilter
    : 'todos'
  const superAdmin = ADMIN_USUARIO_SUPER_ADMIN.includes(input.superAdmin as AdminUsuarioSuperAdminFilter)
    ? input.superAdmin as AdminUsuarioSuperAdminFilter
    : 'todos'
  const pagina = Math.max(1, Number.parseInt(typeof input.pagina === 'string' ? input.pagina : '1', 10) || 1)
  const requestedSize = Number.parseInt(typeof input.porPagina === 'string' ? input.porPagina : '20', 10)
  const porPagina = ADMIN_USUARIO_PAGE_SIZES.includes(requestedSize as AdminUsuarioPageSize)
    ? requestedSize as AdminUsuarioPageSize
    : 20
  return { busca, papel, status, superAdmin, pagina, porPagina }
}

export function conviteInputFromFormData(formData: FormData) {
  return {
    nome: String(formData.get('nome') || ''),
    email: String(formData.get('email') || ''),
    tipo: String(formData.get('tipo') || ''),
    fundoIds: formData.getAll('fundoIds').map(String),
  }
}
