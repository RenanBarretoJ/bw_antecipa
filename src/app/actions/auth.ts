'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { loginSchema, cadastroSchema } from '@/lib/validations/auth'

export type AuthState = {
  errors?: Record<string, string[]>
  message?: string
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

  const { error } = await supabase.auth.signInWithPassword({
    email: validated.data.email,
    password: validated.data.password,
  })

  if (error) {
    return {
      message: 'E-mail ou senha incorretos.',
    }
  }

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { message: 'Erro ao autenticar. Tente novamente.' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = (profile as { role: string } | null)?.role || 'cedente'

  const dashboards: Record<string, string> = {
    gestor: '/gestor/dashboard',
    cedente: '/cedente/dashboard',
    sacado: '/sacado/dashboard',
    consultor: '/consultor/dashboard',
  }

  redirect(dashboards[role] || '/cedente/dashboard')
}

export async function signup(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const rawData = {
    nome_completo: formData.get('nome_completo') as string,
    email: formData.get('email') as string,
    password: formData.get('password') as string,
    confirmPassword: formData.get('confirmPassword') as string,
  }

  const validated = cadastroSchema.safeParse(rawData)

  if (!validated.success) {
    return {
      errors: validated.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.signUp({
    email: validated.data.email,
    password: validated.data.password,
    options: {
      data: {
        nome_completo: validated.data.nome_completo,
        role: 'cedente',
      },
    },
  })

  if (error) {
    if (error.message.includes('already registered')) {
      return { message: 'Este e-mail ja esta cadastrado.' }
    }
    return { message: 'Erro ao criar conta. Tente novamente.' }
  }

  return {
    message: 'Conta criada com sucesso! Verifique seu e-mail para confirmar o cadastro.',
  }
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
