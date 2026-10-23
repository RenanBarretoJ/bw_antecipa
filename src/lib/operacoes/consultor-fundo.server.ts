import 'server-only'

import { AuthorizationError, assertRole, type AuthContext } from '@/lib/auth/authorization'

/** Additional fund scope after the canonical operation/Cedente access guard. */
export async function exigirFundoConsultorOperacao(
  context: AuthContext,
  operacao: { cedente_id: string; cedente_fundo_id: string | null },
): Promise<void> {
  assertRole(context.profile.role, ['consultor'])
  const deny = () => new AuthorizationError('Operação não disponível para esta consultoria.', 'NOT_FOUND')
  if (!operacao.cedente_fundo_id) throw deny()
  const { data: vinculo, error: vinculoError } = await context.supabase.from('cedente_fundos')
    .select('fundo_id,status').eq('id', operacao.cedente_fundo_id)
    .eq('cedente_id', operacao.cedente_id).eq('status', 'ativo').maybeSingle()
  if (vinculoError || !vinculo || vinculo.status !== 'ativo') throw deny()
  const [{ data: fundo, error: fundoError }, { data: cedentes, error: cedentesError }] = await Promise.all([
    context.supabase.from('fundos').select('id').eq('id', vinculo.fundo_id).eq('ativo', true).maybeSingle(),
    context.supabase.from('consultor_cedentes').select('consultor_id')
      .eq('cedente_id', operacao.cedente_id).eq('status', 'ativo'),
  ])
  if (fundoError || !fundo || cedentesError || !cedentes?.length) throw deny()
  // Both grants must belong to the same consultancy; unrelated organizations cannot be composed.
  const { data: grant, error: grantError } = await context.supabase.from('consultor_fundos')
    .select('consultor_id').in('consultor_id', cedentes.map(c => c.consultor_id))
    .eq('fundo_id', vinculo.fundo_id).eq('status', 'ativo').limit(1).maybeSingle()
  if (grantError || !grant) throw deny()
}
