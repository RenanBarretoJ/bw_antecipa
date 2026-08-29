import { requireOperationAccess } from '@/lib/auth/authorization'
import { carregarVisaoExposicaoOperacaoCanonica } from '@/lib/financeiro/risco/visao-operacional.server'
import { createAdminClient } from '@/lib/supabase/server'
import { ExposicaoLogisticaCard } from './ExposicaoLogisticaCard'

export async function ExposicaoLogisticaOperacaoServer({
  operacaoId,
  variante,
}: {
  operacaoId: string
  variante: 'gestor-operacao' | 'cedente-operacao'
}) {
  await requireOperationAccess(operacaoId)
  const admin = createAdminClient()
  const { data: operacao, error } = await admin.from('operacoes')
    .select('id,cedente_fundo_id,politica_snapshot,risco_execucao_id')
    .eq('id', operacaoId)
    .maybeSingle()
  if (error || !operacao?.cedente_fundo_id) return null
  const operacaoCanonica = operacao as unknown as {
    cedente_fundo_id: string
    politica_snapshot: unknown
    risco_execucao_id: string | null
  }

  const { data: vinculo } = await admin.from('cedente_fundos')
    .select('fundo_id')
    .eq('id', operacaoCanonica.cedente_fundo_id)
    .maybeSingle()
  if (!vinculo) return null
  const fundoId = (vinculo as unknown as { fundo_id: string }).fundo_id

  const visao = await carregarVisaoExposicaoOperacaoCanonica({
    operacaoId,
    fundoId,
    politicaSnapshot: operacaoCanonica.politica_snapshot,
    riscoExecucaoId: operacaoCanonica.risco_execucao_id,
  })
  return visao ? <ExposicaoLogisticaCard visao={visao} variante={variante} /> : null
}
