import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'

function appBaseUrl() {
  const configured = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3001'
}

export async function convidarUsuarioAuth(input: { email: string; nome: string }) {
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    data: { role: 'gestor', nome_completo: input.nome },
    redirectTo: `${appBaseUrl()}/redefinir-senha`,
  })
  if (error || !data.user) {
    throw new Error(error?.message || 'O Supabase Auth nao retornou o usuario convidado.')
  }
  return { userId: data.user.id }
}

export async function removerConviteAuthIncompleto(userId: string) {
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) throw new Error(error.message)
}

export async function atualizarBloqueioUsuarioAuth(userId: string, inativo: boolean) {
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: inativo ? '876000h' : 'none',
  })
  if (error) throw new Error(error.message)
}

export async function removerFatoresMfaAuth(userId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId })
  if (error) throw new Error(error.message)

  const factors = (data?.factors || []).filter((factor) => Boolean(factor.id))
  let removidos = 0
  for (const factor of factors) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id })
    if (deleteError) throw new Error(deleteError.message)
    removidos += 1
  }
  return { removidos }
}
