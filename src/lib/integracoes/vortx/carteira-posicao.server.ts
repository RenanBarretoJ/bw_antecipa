import 'server-only'
import { z } from 'zod'
import type { AppSupabaseClient } from '@/lib/auth/authorization'
import type { PosicaoCarteiraVortx } from './carteira-operacao'

const cotasSchema = z.array(z.object({ codigoCarteira: z.string(), rotulo: z.string(), patrimonioLiquido: z.string().regex(/^\d+(\.\d{1,4})?$/) })).min(1).max(100)

/** Authenticated client only: canonical financial RLS decides visibility. No raw JSON or bucket/path DTO. */
export async function carregarPosicaoCarteiraVortx(client: AppSupabaseClient, fundoId: string, importacaoId?: string): Promise<(PosicaoCarteiraVortx & { vigente: boolean }) | null> {
  let query = client.from('importacoes_financeiras').select('id,fundo_id,data_referencia,valor_total,metadados,status')
    .eq('fundo_id', fundoId).eq('provedor', 'VORTX').eq('tipo_base', 'CARTEIRA').eq('fonte_ambiente', 'producao')
  query = importacaoId ? query.eq('id', importacaoId) : query.eq('status', 'PUBLICADA')
  const { data, error } = await query.order('data_referencia', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error('CARTEIRA_LEITURA_INDISPONIVEL')
  if (!data) return null
  if (data.fundo_id !== fundoId || (importacaoId && data.id !== importacaoId)) throw new Error('CARTEIRA_LEITURA_FORA_DO_ESCOPO')
  const cotas = cotasSchema.parse(data.metadados.cotas)
  const total = z.union([z.string(), z.number()]).transform(String).parse(data.valor_total)
  if (!/^\d+(\.\d{1,4})?$/.test(total)) throw new Error('CARTEIRA_PL_INVALIDO')
  return { dataReferencia: data.data_referencia, patrimonioLiquidoTotal: total, cotas, vigente: data.status === 'PUBLICADA' }
}
