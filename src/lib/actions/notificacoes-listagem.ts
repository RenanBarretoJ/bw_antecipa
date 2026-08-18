'use server'

import { revalidatePath } from 'next/cache'
import { requireAuthenticated } from '@/lib/auth/authorization'
import { createAdminClient } from '@/lib/supabase/server'
import {
  carregarNotificacoesUsuario,
  contarNotificacoesDoContext,
  contarNotificacoesUsuario,
} from '@/lib/notificacoes/listagem.server'
import type { NotificacaoFiltro } from '@/lib/notificacoes/contracts'

export async function carregarMaisNotificacoes(input: {
  cursor: string
  filtro: NotificacaoFiltro
  limit?: number
}) {
  return carregarNotificacoesUsuario({
    cursor: input.cursor,
    filtro: input.filtro,
    limit: input.limit ?? 20,
    incluirContadores: false,
  })
}

export async function carregarSinoNotificacoes() {
  return carregarNotificacoesUsuario({ limit: 10, filtro: 'todas', incluirContadores: true })
}

export async function recontarNotificacoesNaoLidas() {
  return contarNotificacoesUsuario()
}

export async function marcarNotificacaoComoLida(notificacaoId: string) {
  const context = await requireAuthenticated()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notificacaoId)) {
    return { success: false, message: 'Notificacao invalida.' }
  }

  const { data, error } = await createAdminClient()
    .from('notificacoes')
    .update({ lida: true } as never)
    .eq('id', notificacaoId)
    .eq('usuario_id', context.user.id)
    .select('id')
    .maybeSingle()

  if (error || !data) return { success: false, message: 'Nao foi possivel marcar a notificacao como lida.' }
  revalidatePath(`/${context.profile.role}/notificacoes`)
  return { success: true, contadores: await contarNotificacoesDoContext(context) }
}

export async function marcarTodasNotificacoesComoLidas() {
  const context = await requireAuthenticated()
  const { error } = await createAdminClient()
    .from('notificacoes')
    .update({ lida: true } as never)
    .eq('usuario_id', context.user.id)
    .eq('lida', false)

  if (error) return { success: false, message: 'Nao foi possivel marcar todas as notificacoes como lidas.' }
  revalidatePath(`/${context.profile.role}/notificacoes`)
  return { success: true, contadores: await contarNotificacoesDoContext(context) }
}
