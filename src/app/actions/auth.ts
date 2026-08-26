'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { loginSchema } from '@/lib/validations/auth'
import { obterEstadoMfaUsuario } from '@/lib/auth/mfa'
import { limparFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import { carregarAcessoPlataforma, resolverDestinoAposAutenticacao } from '@/lib/auth/platform-access'
import type { UserRole } from '@/types/database'
import { registrarTentativaRateLimit, verificarRateLimit } from '@/lib/security/rate-limit'
import { IdentityQueryError, loadSessionProfile } from '@/lib/auth/identity-query'

export type AuthState = {
  errors?: Record<string, string[]>
  message?: string
  authenticated?: boolean
} | undefined

export async function login(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const rawData = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const validated = loginSchema.safeParse(rawData)

  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()
  const loginIdentifier = validated.data.email.toLowerCase().trim()
  const limited = await verificarRateLimit({ escopo: 'login', identifier: loginIdentifier, limite: 5 })
  if (!limited.allowed) {
    return {
      message: 'Muitas tentativas de acesso. Aguarde antes de tentar novamente.',
    }
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: validated.data.email,
    password: validated.data.password,
  })

  if (error) {
    await registrarTentativaRateLimit({ escopo: 'login', identifier: loginIdentifier, sucesso: false })
    return {
      message: 'E-mail ou senha incorretos.',
    }
  }
  await registrarTentativaRateLimit({ escopo: 'login', identifier: loginIdentifier, sucesso: true })

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { message: 'Erro ao autenticar. Tente novamente.' }
  }

  let profile
  try {
    profile = await loadSessionProfile(supabase, user.id)
  } catch (queryError) {
    await supabase.auth.signOut({ scope: 'local' })
    if (queryError instanceof IdentityQueryError) {
      return { message: 'Não foi possível validar sua identidade. Tente novamente.' }
    }
    throw queryError
  }

  if (!profile) {
    await supabase.auth.signOut({ scope: 'local' })
    return { message: 'Perfil do usuário não encontrado.' }
  }

  const role = profile.role
  const estadoMfa = await obterEstadoMfaUsuario(supabase)

  if (estadoMfa.exigeMfa && !estadoMfa.possuiFatorVerificado) {
    redirect('/mfa/setup')
  }

  if ((estadoMfa.exigeMfa || estadoMfa.possuiFatorVerificado) && (
    estadoMfa.aalAtual !== 'aal2' || !estadoMfa.sessaoElevadaValida || estadoMfa.sessaoElevadaMetodo !== 'totp'
  )) {
    redirect('/mfa/desafio')
  }

  const access = await carregarAcessoPlataforma(supabase, user.id, role as UserRole)
  redirect(resolverDestinoAposAutenticacao(access))
}

export async function signup(_prevState: AuthState, _formData: FormData): Promise<AuthState> {
  void _prevState
  void _formData
  return { message: 'A criacao de conta Cedente ocorre exclusivamente por convite de um gestor.' }
}

export async function logout() {
  const supabase = await createClient()
  await Promise.allSettled([
    supabase.rpc('revogar_sessao_mfa_atual', { p_motivo: 'logout_usuario' }),
    limparFluxoAutenticacao(),
  ])
  await supabase.auth.signOut({ scope: 'local' })
  redirect('/login')
}
