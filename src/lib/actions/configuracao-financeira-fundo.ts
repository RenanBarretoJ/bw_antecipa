'use server'

import { requireAuthenticated } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { revalidatePath } from 'next/cache'
import type { BaseValorAntecipacao } from '@/lib/operacoes/base-antecipacao'

export async function configurarBaseAntecipacao(cedenteFundoId: string, base: BaseValorAntecipacao) {
  const context = await requireAuthenticated()
  await exigirSessaoElevada(context)
  if (!['BRUTO', 'LIQUIDO'].includes(base)) return { success: false, message: 'Selecione uma base válida.' }
  // RPC authorizes the actual fund and actor, independently of cookies or supplied IDs.
  const { error } = await context.supabase.rpc('configurar_base_antecipacao', {
    p_cedente_fundo_id: cedenteFundoId, p_base: base,
  })
  if (error) return { success: false, message: 'Não foi possível alterar a base. Verifique sua permissão no fundo e tente novamente.' }
  revalidatePath('/gestor/cedentes')
  revalidatePath('/consultor/operacoes/nova')
  revalidatePath('/cedente/operacoes/nova')
  return { success: true, message: 'Base atualizada. A alteração vale somente para novas operações.' }
}

export async function configurarComissaoConsultorFundo(consultorId: string, fundoId: string, habilitada: boolean) {
  const context = await requireAuthenticated()
  await exigirSessaoElevada(context)
  if (typeof habilitada !== 'boolean') return { success: false, message: 'Configuração inválida.' }
  const { error } = await context.supabase.rpc('configurar_comissao_consultor_fundo', {
    p_consultor_id: consultorId, p_fundo_id: fundoId, p_habilitada: habilitada,
  })
  if (error) return { success: false, message: 'Não foi possível alterar a configuração. Verifique sua permissão no fundo.' }
  revalidatePath('/gestor/configuracoes')
  revalidatePath(`/admin/consultorias/${consultorId}`)
  revalidatePath('/consultor/dashboard')
  revalidatePath('/consultor/relatorios')
  return { success: true, message: 'Configuração de comissão atualizada.' }
}
