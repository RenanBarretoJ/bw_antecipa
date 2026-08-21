import 'server-only'

import type { createAdminClient } from '@/lib/supabase/server'

type DynamicClient = ReturnType<typeof createAdminClient> & {
  from: (table: string) => ReturnType<ReturnType<typeof createAdminClient>['from']>
}

export type CarteiraOficialBootstrap = {
  importacaoId: string
  dataReferencia: string
  snapshotId: string
  patrimonioLiquido: string
}

export type EstadoBootstrapFinanceiro = {
  fundoVirgem: boolean
  carteiraOficial: CarteiraOficialBootstrap | null
}

export async function resolverBootstrapFinanceiro(client: DynamicClient, fundoId: string): Promise<EstadoBootstrapFinanceiro> {
  const { data, error } = await client.rpc('resolver_bootstrap_financeiro', { p_fundo_id: fundoId })
  if (error) throw new Error(`Nao foi possivel resolver o estado de bootstrap do fundo: ${error.message}`)
  const result = data as unknown as { fundo_virgem: boolean; carteira_oficial: Record<string, unknown> | null }
  const carteira = result.carteira_oficial
  return {
    fundoVirgem: result.fundo_virgem === true,
    carteiraOficial: carteira ? {
      importacaoId: String(carteira.importacao_id),
      dataReferencia: String(carteira.data_referencia),
      snapshotId: String(carteira.snapshot_id),
      patrimonioLiquido: String(carteira.patrimonio_liquido),
    } : null,
  }
}
