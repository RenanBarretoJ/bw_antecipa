import { z } from 'zod'
import type { PosicaoCarteiraVortx } from './carteira-operacao'
import type { QueryBases } from './central-bases'

export const TAMANHO_PAGINA_CARTEIRA = 20
const filtrosSchema = z.object({ estado: z.enum(['PUBLICADA', 'RETIFICADA']).optional(), referencia: z.iso.date().optional() }).strict()
export type FiltrosCarteira = z.infer<typeof filtrosSchema>
export type RegistroCarteira = PosicaoCarteiraVortx & {
  id: string; estado: 'PUBLICADA' | 'RETIFICADA'; recebidaEm: string; publicadaEm: string; substituidaEm: string | null
}
export type HistoricoCarteira = { registros: RegistroCarteira[]; total: number; pagina: number; filtros: FiltrosCarteira }

export function lerPaginaCarteira(value: unknown): number {
  return typeof value === 'string' && /^\d+$/.test(value) ? Math.min(10000, Math.max(1, Number(value))) : 1
}

export function lerFiltrosCarteira(query: QueryBases): FiltrosCarteira {
  const estado = filtrosSchema.shape.estado.safeParse(query.carteiraEstado)
  const referencia = filtrosSchema.shape.referencia.safeParse(query.carteiraReferencia)
  return { ...(estado.success && estado.data ? { estado: estado.data } : {}), ...(referencia.success && referencia.data ? { referencia: referencia.data } : {}) }
}

/** Wallet filters are independent from callback reports; keep the other list and Admin tab intact. */
export function hrefHistoricoCarteira(base: string, filtros: FiltrosCarteira, pagina = 1): string {
  const [path, search = ''] = base.split('#')[0].split('?')
  const params = new URLSearchParams(search)
  params.delete('carteiraEstado'); params.delete('carteiraReferencia')
  if (filtros.estado) params.set('carteiraEstado', filtros.estado)
  if (filtros.referencia) params.set('carteiraReferencia', filtros.referencia)
  params.set('carteiraPagina', String(lerPaginaCarteira(String(pagina))))
  return `${path}?${params.toString()}#historico-carteira`
}
