'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireAuthenticated, requireCedenteAccess } from '@/lib/auth/authorization'
import { CEDENTE_FUNDO_ATIVO_COOKIE } from '@/lib/fundos/cedente-fundo-ativo'
import { CedenteFundoError, resolverCedenteFundoAtivo } from '@/lib/fundos/cedente-fundo'

export async function carregarSeletorCedenteFundoAtivo() {
  const auth = await requireAuthenticated()
  if (auth.profile.role !== 'cedente') throw new Error('Perfil não autorizado.')
  const { data: cedenteId, error } = await auth.supabase.rpc('get_user_cedente_id')
  if (error) throw new Error('Não foi possível carregar o contexto do cedente.')
  if (!cedenteId) return { links: [], selected: '' }
  const now = new Date().toISOString()
  const { data: links, error: linksError } = await auth.supabase.from('cedente_fundos')
    .select('id, fundo_id, fundos(id, nome, ativo)').eq('cedente_id', cedenteId).eq('status', 'ativo')
    .lte('vigente_desde', now).or(`vigente_ate.is.null,vigente_ate.gt.${now}`)
    .order('vigente_desde', { ascending: false })
  if (linksError) throw new Error('Não foi possível carregar os Fundos do cedente.')
  const rows = (links ?? []) as unknown as Array<{ id: string; fundo_id: string; fundos: { id: string; nome: string; ativo: boolean } | null }>
  const active = rows.filter((row) => row.fundos?.ativo === true).map((row) => ({ id: row.id, nome: row.fundos!.nome }))
  let selected = ''
  try {
    selected = (await resolverCedenteFundoAtivo(cedenteId, auth.supabase)).cedenteFundo?.id ?? ''
  } catch (cause) {
    if (!(cause instanceof CedenteFundoError) || cause.code !== 'MULTIPLOS_VINCULOS_ATIVOS') throw cause
  }
  return { links: active, selected: active.some((row) => row.id === selected) ? selected : '' }
}

export async function selecionarCedenteFundoAtivo(cedenteFundoId: string): Promise<{ success: boolean; message: string }> {
  const context = await requireAuthenticated()
  if (context.profile.role !== 'cedente') return { success: false, message: 'A selecao de fundo do cedente e exclusiva para usuarios cedentes.' }

  // get_user_cedente_id() resolve tanto o dono (cedentes.user_id) quanto um
  // usuario convidado via cedente_acessos.
  const { data: cedenteIdResolvido } = await context.supabase.rpc('get_user_cedente_id')
  const { data: cedente, error: cedenteError } = cedenteIdResolvido
    ? await context.supabase.from('cedentes').select('id').eq('id', cedenteIdResolvido).maybeSingle()
    : { data: null, error: null }
  if (cedenteError) return { success: false, message: `Erro ao consultar cadastro do cedente: ${cedenteError.message}` }
  if (!cedente) return { success: false, message: 'Cadastro de cedente nao encontrado.' }

  const cedenteId = (cedente as { id: string }).id
  await requireCedenteAccess(cedenteId, context.supabase)

  const { data: link, error } = await context.supabase
    .from('cedente_fundos')
    .select('id, cedente_id, status')
    .eq('id', cedenteFundoId)
    .eq('cedente_id', cedenteId)
    .eq('status', 'ativo')
    .maybeSingle()

  if (error) return { success: false, message: `Erro ao validar fundo do cedente: ${error.message}` }
  if (!link) return { success: false, message: 'Vinculo cedente-fundo ativo nao encontrado para este usuario.' }

  const cookieStore = await cookies()
  cookieStore.set(CEDENTE_FUNDO_ATIVO_COOKIE, cedenteFundoId, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
  })

  revalidatePath('/cedente')
  return { success: true, message: 'Fundo operacional selecionado.' }
}
