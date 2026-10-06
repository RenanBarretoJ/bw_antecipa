import 'server-only'
import { cookies } from 'next/headers'
import { AuthorizationError, type AuthContext } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { CedenteFundoError, resolverCedenteFundoAtivo } from '@/lib/fundos/cedente-fundo'
import type { NotificacaoContexto, NotificacaoEscopo } from './contracts'

export const NOTIFICACOES_FUNDO_COOKIE = 'bw_notificacoes_fundo_id'

export async function resolverContextoNotificacoes(auth: AuthContext): Promise<NotificacaoContexto> {
  const { data, error } = await auth.supabase.rpc('listar_fundos_notificacoes')
  if (error) throw new Error('Não foi possível validar o contexto das notificações.')
  const fundos = data ?? []
  const role = auth.profile.role
  const seletorProprio = role === 'sacado' || role === 'consultor'
  let fundoId: string | null = null
  if (role === 'gestor' && fundos.length) {
    fundoId = (await resolverContextoFundoGestor(auth)).fundoId
  } else if (role === 'cedente' && fundos.length) {
    const { data: cedenteId, error: cedenteError } = await auth.supabase.rpc('get_user_cedente_id')
    if (cedenteError) throw new Error('Não foi possível validar o cedente das notificações.')
    if (cedenteId) {
      try {
        fundoId = (await resolverCedenteFundoAtivo(cedenteId, auth.supabase)).fundo?.id ?? null
      } catch (cause) {
        if (!(cause instanceof CedenteFundoError) || cause.code !== 'MULTIPLOS_VINCULOS_ATIVOS') throw cause
        // The canonical header selector must choose the operational fund first.
      }
    }
  } else if (seletorProprio) {
    const selected = (await cookies()).get(NOTIFICACOES_FUNDO_COOKIE)?.value
    fundoId = fundos.find((fundo) => fundo.id === selected)?.id ?? fundos[0]?.id ?? null
  }
  if (fundoId && !fundos.some((fundo) => fundo.id === fundoId)) fundoId = null
  return { userId: auth.user.id, role, fundos, fundoId, seletorProprio }
}

export async function validarContextoNotificacoes(auth: AuthContext, escopo: NotificacaoEscopo) {
  if (!escopo || !['FUNDO', 'GLOBAL'].includes(escopo.scope)) throw new AuthorizationError('Contexto inválido.', 'FORBIDDEN')
  if (escopo.scope === 'GLOBAL') {
    if (escopo.fundoId !== null) throw new AuthorizationError('Contexto inválido.', 'FORBIDDEN')
    return
  }
  const contexto = await resolverContextoNotificacoes(auth)
  if (!escopo.fundoId || contexto.fundoId !== escopo.fundoId) {
    throw new AuthorizationError('O Fundo mudou ou não está autorizado. Atualize as notificações.', 'FORBIDDEN')
  }
}
