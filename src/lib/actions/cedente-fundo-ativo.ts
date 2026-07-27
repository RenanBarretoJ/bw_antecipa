'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { requireAuthenticated, requireCedenteAccess } from '@/lib/auth/authorization'
import { CEDENTE_FUNDO_ATIVO_COOKIE } from '@/lib/fundos/cedente-fundo-ativo'

export async function selecionarCedenteFundoAtivo(cedenteFundoId: string): Promise<{ success: boolean; message: string }> {
  const context = await requireAuthenticated()
  if (context.profile.role !== 'cedente') return { success: false, message: 'A selecao de fundo do cedente e exclusiva para usuarios cedentes.' }

  const { data: cedente, error: cedenteError } = await context.supabase
    .from('cedentes')
    .select('id')
    .eq('user_id', context.user.id)
    .maybeSingle()
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
