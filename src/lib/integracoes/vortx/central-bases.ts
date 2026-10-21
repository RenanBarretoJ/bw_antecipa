import { z } from 'zod'
import { TIPOS_RELATORIO_VORTX } from './relatorios-contrato'

export const TAMANHO_PAGINA_BASES = 20
export const ESTADOS_PEDIDO = [
  ['registrada', 'Preparando pedido'], ['enviando', 'Consultando a Vórtx'],
  ['aceita', 'Pedido aceito'], ['recusada', 'Pedido recusado'],
  ['indeterminada', 'Retorno não confirmado'], ['falha_autenticacao', 'Não enviado'],
] as const

export const filtrosBasesSchema = z.object({
  tipo: z.enum(TIPOS_RELATORIO_VORTX).optional(),
  origem: z.enum(['MANUAL', 'CRON']).optional(),
  estado: z.enum(['registrada', 'enviando', 'aceita', 'recusada', 'indeterminada', 'falha_autenticacao']).optional(),
  referencia: z.iso.date().optional(),
}).strict()
export type FiltrosBases = z.infer<typeof filtrosBasesSchema>
export type QueryBases = Record<string, string | string[] | undefined>

/** URL values are normalized independently. Unknown/duplicated fields never become database predicates. */
export function lerFiltrosBases(query: QueryBases): FiltrosBases {
  const result: Record<string, string> = {}
  for (const key of ['tipo', 'origem', 'estado', 'referencia'] as const) {
    const parsed = filtrosBasesSchema.shape[key].safeParse(query[key])
    if (parsed.success && parsed.data) result[key] = parsed.data
  }
  return filtrosBasesSchema.parse(result)
}

export function hrefBases(base: string, filtros: FiltrosBases, pagina = 1): string {
  const [path, search = ''] = base.split('?')
  const params = new URLSearchParams(search)
  for (const key of ['tipo', 'origem', 'estado', 'referencia'] as const) {
    params.delete(key)
    if (filtros[key]) params.set(key, filtros[key])
  }
  params.set('pagina', String(Math.min(10000, Math.max(1, pagina))))
  return `${path}?${params.toString()}#historico-bases`
}
