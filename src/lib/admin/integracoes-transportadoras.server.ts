import 'server-only'

import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import type {
  AdminIntegracaoTransportadora,
  AdminWebhookEventoDetalhe,
  AdminWebhookEventosFiltro,
  AdminWebhookEventosListResult,
} from '@/lib/admin/integracoes-transportadoras'

export async function listarAdminIntegracoesTransportadoras(): Promise<AdminIntegracaoTransportadora[]> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_listar_integracoes_transportadoras')
  if (error) throw new Error('Nao foi possivel carregar as integracoes de transportadora.')
  return (data || []) as unknown as AdminIntegracaoTransportadora[]
}

const PAGE_SIZE = 25

export async function listarAdminWebhookEventosTransportadora(
  filtro: AdminWebhookEventosFiltro,
): Promise<AdminWebhookEventosListResult> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_listar_webhook_eventos_transportadora', {
    p_fundo_id: filtro.fundoId || null,
    p_integracao_id: filtro.integracaoId || null,
    p_status: filtro.status || null,
    p_chave_nfe: filtro.chaveNfe || null,
    p_chave_cte: filtro.chaveCte || null,
    p_desde: filtro.desde || null,
    p_ate: filtro.ate || null,
    p_limit: filtro.porPagina || PAGE_SIZE,
    p_offset: ((filtro.pagina || 1) - 1) * (filtro.porPagina || PAGE_SIZE),
  })
  if (error) throw new Error('Nao foi possivel carregar os eventos do webhook.')
  return data as unknown as AdminWebhookEventosListResult
}

export async function obterAdminWebhookEventoTransportadora(id: string): Promise<AdminWebhookEventoDetalhe | null> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_obter_webhook_evento_transportadora', { p_webhook_evento_id: id })
  if (error) throw new Error('Nao foi possivel carregar o evento do webhook.')
  return data as unknown as AdminWebhookEventoDetalhe | null
}
