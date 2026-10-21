import 'server-only'
import { AuthorizationError, requireAuthenticated } from '@/lib/auth/authorization'
import { contextoRelatoriosSchema, historicoRelatorioSchema, relatoriosPreviewPermitidos } from './relatorios-operacao'

export async function carregarContextoRelatorios(fundoId: string) {
  if (!relatoriosPreviewPermitidos(fundoId)) throw new AuthorizationError('Solicitação de relatórios indisponível neste ambiente ou Fundo.', 'FORBIDDEN')
  const auth = await requireAuthenticated()
  const { data, error } = await auth.supabase.rpc('vortx_contexto_relatorios', { p_fundo_id: fundoId })
  const parsed = contextoRelatoriosSchema.safeParse(data)
  if (error || !parsed.success || parsed.data.fundo.id !== fundoId) {
    throw new AuthorizationError('É necessário vínculo ativo com este Fundo.', 'FORBIDDEN')
  }
  return { auth, contexto: parsed.data }
}

export async function carregarHistoricoRelatorios(fundoId: string, pagina: number) {
  const { auth, contexto } = await carregarContextoRelatorios(fundoId)
  const { data, error } = await auth.supabase.rpc('admin_listar_relatorios_vortx', { p_fundo_id: fundoId, p_pagina: pagina })
  if (error) throw new Error('Não foi possível carregar o histórico. Nenhuma consulta foi enviada à Vórtx.')
  return { contexto, historico: historicoRelatorioSchema.parse(data) }
}
