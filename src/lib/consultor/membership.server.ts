import 'server-only'

import {
  assertRole,
  AuthorizationError,
  type AuthContext,
} from '@/lib/auth/authorization'
import type { ConsultorMembershipRole } from '@/lib/consultor/membership'

export type ConsultorMembership = {
  consultorId: string
  papel: ConsultorMembershipRole
}

export async function carregarMembershipConsultorAtiva(
  context: AuthContext,
): Promise<ConsultorMembership> {
  assertRole(context.profile.role, ['consultor'])

  const { data: membership, error: membershipError } = await context.supabase
    .from('consultor_usuarios')
    .select('consultor_id, papel')
    .eq('user_id', context.user.id)
    .eq('status', 'ativo')
    .maybeSingle()

  if (membershipError || !membership) {
    throw new AuthorizationError('Vinculo ativo com a Consultoria nao encontrado.', 'FORBIDDEN')
  }

  const { data: consultoria, error: consultoriaError } = await context.supabase
    .from('consultores')
    .select('id')
    .eq('id', membership.consultor_id)
    .eq('status', 'ativo')
    .maybeSingle()

  if (consultoriaError || !consultoria) {
    throw new AuthorizationError('A Consultoria nao esta ativa.', 'FORBIDDEN')
  }

  return {
    consultorId: membership.consultor_id,
    papel: membership.papel as ConsultorMembershipRole,
  }
}
