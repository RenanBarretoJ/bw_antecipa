import 'server-only'

import { integrationRuntimeEnvironment, resolverIntegracaoPorCapability } from '@/lib/integracoes/resolver.server'
import { CODIGO_CARTEIRA_PATTERN } from '@/lib/integracoes/configuracao-vortx-vrs'
import { createAdminClient } from '@/lib/supabase/server'

export type FonteFinanceira =
  | { tipo: 'LEGADO' }
  | { tipo: 'VORTX'; ambiente: 'homologacao' | 'producao'; codigoCarteira: string }

/** Resolve only the data source. Never changes credential/runtime environment or sends HTTP. */
export async function resolverFonteFinanceira(fundoId: string): Promise<FonteFinanceira> {
  const ambiente = integrationRuntimeEnvironment()
  const result = await resolverIntegracaoPorCapability({ fundoId, ambiente, capability: 'ESTOQUE' })
  if (result.status !== 'CONFIGURADA') {
    if (result.status === 'INDISPONIVEL') throw new Error('A fonte financeira configurada esta indisponivel.')
    const history = await createAdminClient().rpc('financeiro_possui_historico_fonte_vortx', { p_fundo_id: fundoId, p_ambiente: ambiente })
    if (history.error || typeof history.data !== 'boolean') throw new Error('Nao foi possivel confirmar a fonte financeira do Fundo.')
    if (history.data) throw new Error('Fonte Vortx sem configuracao ativa. Estoque legado nao sera usado como substituto.')
    return { tipo: 'LEGADO' }
  }
  const version = result.integrationVersion
  if (version.providerKey !== 'VORTX') return { tipo: 'LEGADO' }
  const codigoCarteira = version.config.codigo_carteira
  if (version.adapterKey !== 'vortx_vrs' || typeof codigoCarteira !== 'string' || !CODIGO_CARTEIRA_PATTERN.test(codigoCarteira)) {
    throw new Error('A fonte financeira Vortx nao possui carteira valida.')
  }
  return { tipo: 'VORTX', ambiente, codigoCarteira }
}

/** Absence of a native snapshot is absence, not permission to reuse Fromtis. */
export function filtroFonteFinanceira(fonte: FonteFinanceira): string {
  if (fonte.tipo === 'LEGADO') return 'provedor.neq.VORTX'
  if (!CODIGO_CARTEIRA_PATTERN.test(fonte.codigoCarteira)
    || !['homologacao', 'producao'].includes(fonte.ambiente)) throw new Error('Escopo financeiro invalido.')
  return `and(provedor.eq.VORTX,fonte_ambiente.eq.${fonte.ambiente},fonte_carteira.eq.${fonte.codigoCarteira})`
}

export const TABELA_LEITURA_ESTOQUE = 'estoque_fontes_leitura'
