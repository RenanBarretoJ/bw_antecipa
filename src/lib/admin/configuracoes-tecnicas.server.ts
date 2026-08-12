import 'server-only'

import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import type { AdminConfiguracoesTecnicasFundo } from '@/lib/admin/configuracoes-tecnicas'

export async function obterConfiguracoesTecnicasAdminFundo(fundoId: string, paginaExecucoes = 1): Promise<AdminConfiguracoesTecnicasFundo> {
  const context = await requireSuperAdmin()
  const rpc = context.supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  const { data, error } = await rpc('admin_obter_configuracoes_tecnicas_fundo', {
    p_fundo_id: fundoId,
    p_execucoes_limite: 20,
    p_execucoes_offset: (Math.max(1, paginaExecucoes) - 1) * 20,
  })
  if (error || !data) throw new Error('Nao foi possivel carregar as configuracoes tecnicas do fundo.')
  return data as AdminConfiguracoesTecnicasFundo
}
