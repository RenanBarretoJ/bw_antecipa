'use server'

import { cookies } from 'next/headers'
import { requireAuthenticated } from '@/lib/auth/authorization'
import { carregarNotificacoesUsuario, contarNotificacoesDoContext } from '@/lib/notificacoes/listagem.server'
import { NOTIFICACOES_FUNDO_COOKIE, resolverContextoNotificacoes, validarContextoNotificacoes } from '@/lib/notificacoes/contexto.server'
import type { NotificacaoEscopo, NotificacaoFiltro } from '@/lib/notificacoes/contracts'

export async function carregarContextoNotificacoes() {
  return resolverContextoNotificacoes(await requireAuthenticated())
}

export async function selecionarFundoNotificacoes(fundoId: string) {
  const contexto = await carregarContextoNotificacoes()
  if (!contexto.seletorProprio || !contexto.fundos.some((fundo) => fundo.id === fundoId)) {
    throw new Error('Fundo não autorizado para este seletor.')
  }
  const cookieStore = await cookies()
  cookieStore.set(NOTIFICACOES_FUNDO_COOKIE, fundoId, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 30,
  })
  return carregarContextoNotificacoes()
}

export async function carregarPaginaNotificacoes(input: { escopo: NotificacaoEscopo; cursor?: string | null; filtro: NotificacaoFiltro; limit?: number }) {
  return carregarNotificacoesUsuario(input)
}

export async function marcarNotificacoesLidas(escopo: NotificacaoEscopo, notificacaoId: string | null) {
  const auth = await requireAuthenticated()
  await validarContextoNotificacoes(auth, escopo)
  if (notificacaoId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notificacaoId)) {
    throw new Error('Notificação inválida.')
  }
  const { error } = await auth.supabase.rpc('marcar_notificacoes_lidas', {
    p_scope: escopo.scope, p_fundo_id: escopo.fundoId, p_id: notificacaoId,
  })
  if (error) throw new Error('Não foi possível marcar as notificações neste contexto.')
  return contarNotificacoesDoContext(auth, escopo)
}
