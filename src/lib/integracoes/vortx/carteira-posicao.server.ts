import 'server-only'
import { z } from 'zod'
import type { AppSupabaseClient } from '@/lib/auth/authorization'
import type { PosicaoCarteiraVortx } from './carteira-operacao'
import { TAMANHO_PAGINA_CARTEIRA, lerFiltrosCarteira, lerPaginaCarteira, type HistoricoCarteira } from './carteira-historico'
import type { QueryBases } from './central-bases'

const cotasSchema = z.array(z.object({ codigoCarteira: z.string(), rotulo: z.string(), patrimonioLiquido: z.string().regex(/^\d+(\.\d{1,4})?$/) })).min(1).max(100)

function lerPosicao(row: { data_referencia: string; valor_total: unknown; metadados: unknown }): PosicaoCarteiraVortx {
  const cotas = z.object({ cotas: cotasSchema }).parse(row.metadados).cotas
  const total = z.union([z.string(), z.number()]).transform(String).parse(row.valor_total)
  if (!/^\d+(\.\d{1,4})?$/.test(total)) throw new Error('CARTEIRA_PL_INVALIDO')
  return { dataReferencia: z.iso.date().parse(row.data_referencia), patrimonioLiquidoTotal: total, cotas }
}

/** Authenticated client only: canonical financial RLS decides visibility. No raw JSON or bucket/path DTO. */
export async function carregarPosicaoCarteiraVortx(client: AppSupabaseClient, fundoId: string, importacaoId?: string): Promise<(PosicaoCarteiraVortx & { vigente: boolean }) | null> {
  let query = client.from('importacoes_financeiras').select('id,fundo_id,data_referencia,valor_total,metadados,status')
    .eq('fundo_id', fundoId).eq('provedor', 'VORTX').eq('tipo_base', 'CARTEIRA').eq('fonte_ambiente', 'producao')
  query = importacaoId ? query.eq('id', importacaoId) : query.eq('status', 'PUBLICADA')
  const { data, error } = await query.order('data_referencia', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error('CARTEIRA_LEITURA_INDISPONIVEL')
  if (!data) return null
  if (data.fundo_id !== fundoId || (importacaoId && data.id !== importacaoId)) throw new Error('CARTEIRA_LEITURA_FORA_DO_ESCOPO')
  return { ...lerPosicao(data), vigente: data.status === 'PUBLICADA' }
}

/** Read existing canonical versions under the caller's RLS, never the private worker ledger or raw files. */
export async function carregarHistoricoCarteiraVortx(client: AppSupabaseClient, fundoId: string, search: QueryBases = {}): Promise<HistoricoCarteira> {
  const filtros = lerFiltrosCarteira(search), pagina = lerPaginaCarteira(search.carteiraPagina)
  let query = client.from('importacoes_financeiras')
    .select('id,fundo_id,data_referencia,valor_total,metadados,status,recebida_em,publicada_em,substituida_em', { count: 'exact' })
    .eq('fundo_id', fundoId).eq('provedor', 'VORTX').eq('tipo_base', 'CARTEIRA').eq('fonte_ambiente', 'producao')
    .in('status', ['PUBLICADA', 'RETIFICADA'])
  if (filtros.estado) query = query.eq('status', filtros.estado)
  if (filtros.referencia) query = query.eq('data_referencia', filtros.referencia)
  const offset = (pagina - 1) * TAMANHO_PAGINA_CARTEIRA
  const { data, error, count } = await query.order('data_referencia', { ascending: false })
    .order('publicada_em', { ascending: false }).order('id', { ascending: false }).range(offset, offset + TAMANHO_PAGINA_CARTEIRA - 1)
  if (error || data === null || count === null) throw new Error('CARTEIRA_HISTORICO_INDISPONIVEL')
  const registros = data.map(row => {
    if (row.fundo_id !== fundoId) throw new Error('CARTEIRA_LEITURA_FORA_DO_ESCOPO')
    return { ...lerPosicao(row), id: row.id, estado: z.enum(['PUBLICADA', 'RETIFICADA']).parse(row.status),
      recebidaEm: z.iso.datetime({ offset: true }).parse(row.recebida_em), publicadaEm: z.iso.datetime({ offset: true }).parse(row.publicada_em),
      substituidaEm: z.iso.datetime({ offset: true }).nullable().parse(row.substituida_em) }
  })
  return { registros, total: count, pagina, filtros }
}
