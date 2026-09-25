import { z } from 'zod'

export const CONSULTORIA_PAPEIS = ['OWNER', 'ADMIN', 'OPERADOR', 'LEITOR'] as const
export const CONSULTORIA_PAPEIS_CONVITE = ['ADMIN', 'OPERADOR', 'LEITOR'] as const
export type ConsultoriaPapel = typeof CONSULTORIA_PAPEIS[number]

const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Informe um e-mail valido.'))

export const criarConsultoriaSchema = z.object({
  cnpj: z.string().transform((value) => value.replace(/\D/g, '')).pipe(z.string().length(14, 'Informe um CNPJ com 14 digitos.')),
  razaoSocial: z.string().trim().min(3, 'Informe a Razao Social.').max(200),
  nomeFantasia: z.string().trim().max(200).optional(),
  ownerNome: z.string().trim().min(2, 'Informe o nome do OWNER.').max(160),
  ownerEmail: emailSchema,
  fundoIds: z.array(z.uuid()).min(1, 'Selecione ao menos um Fundo.').max(100),
})

export const convidarConsultorUsuarioSchema = z.object({
  consultorId: z.uuid(),
  nome: z.string().trim().min(2, 'Informe o nome.').max(160),
  email: emailSchema,
  papel: z.enum(CONSULTORIA_PAPEIS_CONVITE),
})

export type AdminConsultoriaListItem = {
  id: string
  cnpj: string
  razao_social: string
  nome_fantasia: string | null
  status: 'ativo' | 'inativo'
  usuarios_ativos: number
  cedentes_total: number
  fundos: Array<{ id: string; nome: string }>
  created_at: string
}

export type AdminConsultoriaListResult = {
  itens: AdminConsultoriaListItem[]
  total: number
  pagina: number
  por_pagina: number
  total_paginas: number
}

export type AdminConsultoriaUsuario = {
  id: string
  user_id: string
  nome: string
  email: string
  papel: ConsultoriaPapel
  status: 'pendente' | 'ativo' | 'inativo'
  convite_expires_at: string | null
  ativado_em: string | null
}

export type AdminConsultoriaDetalhe = {
  id: string
  cnpj: string
  razao_social: string
  nome_fantasia: string | null
  status: 'ativo' | 'inativo'
  created_at: string
  updated_at: string
  usuarios: AdminConsultoriaUsuario[]
  fundos: Array<{ id: string; nome: string; cnpj: string; status: 'ativo' | 'inativo'; fundo_ativo: boolean }>
  cedentes: Array<{ id: string; razao_social: string; cnpj: string; status: string; vinculo_status: string }>
}

export type ConsultoriaActionResult = {
  success: boolean
  message: string
  data?: { id: string }
  fieldErrors?: Record<string, string[]>
  notification?: { type: 'success' | 'error' | 'warning'; message: string; details?: string }
}

export function parseConsultoriaFilters(input: Record<string, string | string[] | undefined>) {
  const busca = typeof input.busca === 'string' ? input.busca.trim().slice(0, 120) : ''
  const status: 'todos' | 'ativo' | 'inativo' = input.status === 'ativo' || input.status === 'inativo' ? input.status : 'todos'
  const pagina = Math.max(1, Number.parseInt(typeof input.pagina === 'string' ? input.pagina : '1', 10) || 1)
  const requested = Number.parseInt(typeof input.porPagina === 'string' ? input.porPagina : '20', 10)
  const porPagina = [20, 50, 100].includes(requested) ? requested : 20
  return { busca, status, pagina, porPagina }
}

export function criarConsultoriaInput(formData: FormData) {
  return {
    cnpj: String(formData.get('cnpj') || ''),
    razaoSocial: String(formData.get('razaoSocial') || ''),
    nomeFantasia: String(formData.get('nomeFantasia') || ''),
    ownerNome: String(formData.get('ownerNome') || ''),
    ownerEmail: String(formData.get('ownerEmail') || ''),
    fundoIds: formData.getAll('fundoIds').map(String),
  }
}
