import { z } from 'zod'

export const ADMIN_FUNDO_PAGE_SIZES = [20, 50, 100] as const
export const ADMIN_FUNDO_STATUS = ['todos', 'ativos', 'inativos'] as const

export const FUNDO_CAMPOS_ESTRUTURAIS = [
  'nome',
  'cnpj',
  'administradora_nome',
  'administradora_cnpj',
  'gestora_nome',
  'gestora_cnpj',
  'custodiante_nome',
  'custodiante_cnpj',
  'administradora_endereco',
  'administradora_ato_declaratorio',
  'contato_nome',
  'contato_email',
] as const

export type AdminFundoStatus = typeof ADMIN_FUNDO_STATUS[number]
export type AdminFundoPageSize = typeof ADMIN_FUNDO_PAGE_SIZES[number]

export function normalizarCnpj(value: string) {
  return value.replace(/\D/g, '')
}

export function validarCnpj(value: string) {
  const digits = normalizarCnpj(value)
  if (digits.length !== 14 || /^(\d)\1+$/.test(digits)) return false

  const calcular = (base: string, pesos: number[]) => {
    const soma = pesos.reduce((total, peso, indice) => total + Number(base[indice]) * peso, 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }

  const primeiro = calcular(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  if (Number(digits[12]) !== primeiro) return false
  const segundo = calcular(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return Number(digits[13]) === segundo
}

const cnpjSchema = z.string().trim().refine(validarCnpj, 'CNPJ invalido.').transform(normalizarCnpj)
const textoObrigatorio = z.string().trim().min(2, 'Campo obrigatorio.').max(200, 'Limite de 200 caracteres excedido.')
const textoOpcional = z.string().trim().max(500, 'Limite de 500 caracteres excedido.').transform((value) => value || null)

export const adminFundoSchema = z.object({
  nome: textoObrigatorio,
  cnpj: cnpjSchema,
  administradora_nome: textoObrigatorio,
  administradora_cnpj: cnpjSchema,
  gestora_nome: textoObrigatorio,
  gestora_cnpj: cnpjSchema,
  custodiante_nome: textoOpcional,
  custodiante_cnpj: z.string().trim().transform((value) => value || null).refine((value) => value === null || validarCnpj(value), 'CNPJ invalido.').transform((value) => value ? normalizarCnpj(value) : null),
  administradora_endereco: textoOpcional,
  administradora_ato_declaratorio: textoOpcional,
  contato_nome: textoOpcional,
  contato_email: z.string().trim().transform((value) => value || null).refine((value) => value === null || z.email().safeParse(value).success, 'E-mail invalido.').transform((value) => value?.toLowerCase() || null),
})

export type AdminFundoInput = z.infer<typeof adminFundoSchema>

export type AdminFundoResumo = { total: number; ativos: number; inativos: number }

export type AdminFundoListItem = {
  id: string
  nome: string
  cnpj: string
  administradora_nome: string
  gestora_nome: string
  ativo: boolean
  created_at: string
  updated_at: string
}

export type AdminFundoDetalhe = AdminFundoListItem & AdminFundoInput & {
  created_by: string | null
  created_by_nome: string | null
}

export type AdminFundoAuditoriaItem = {
  id: string
  tipo_evento: string
  ator_usuario_id: string | null
  ator_nome: string | null
  origem: string
  correlation_id: string | null
  dados: Record<string, unknown>
  created_at: string
}

export type AdminFundoListResult = {
  itens: AdminFundoListItem[]
  total: number
  pagina: number
  por_pagina: AdminFundoPageSize
  total_paginas: number
}

export type AdminFundoActionResult = {
  success: boolean
  message: string
  data?: { id: string }
  fieldErrors?: Record<string, string[]>
  notification?: { type: 'success' | 'error'; message: string; details?: string }
}

export function parseAdminFundoFilters(input: Record<string, string | string[] | undefined>) {
  const busca = typeof input.busca === 'string' ? input.busca.trim().slice(0, 120) : ''
  const status = ADMIN_FUNDO_STATUS.includes(input.status as AdminFundoStatus) ? input.status as AdminFundoStatus : 'todos'
  const pagina = Math.max(1, Number.parseInt(typeof input.pagina === 'string' ? input.pagina : '1', 10) || 1)
  const requestedSize = Number.parseInt(typeof input.porPagina === 'string' ? input.porPagina : '20', 10)
  const porPagina = ADMIN_FUNDO_PAGE_SIZES.includes(requestedSize as AdminFundoPageSize) ? requestedSize as AdminFundoPageSize : 20
  return { busca, status, pagina, porPagina }
}

export function fundoInputFromFormData(formData: FormData) {
  return Object.fromEntries(FUNDO_CAMPOS_ESTRUTURAIS.map((field) => [field, String(formData.get(field) || '')]))
}
