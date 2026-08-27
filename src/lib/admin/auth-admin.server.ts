import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'
import { enviarEmailOperacional } from '@/lib/email'

function appBaseUrl() {
  const configured = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3001'
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character)
}

export type ConviteUsuarioAuthPreparado = {
  userId: string
  email: string
  nome: string
  confirmUrl: string
  accessRole: 'gestor' | 'super_admin'
}

export async function prepararConviteUsuarioAuth(input: {
  email: string
  nome: string
  tipo: 'gestor' | 'super_admin'
}): Promise<ConviteUsuarioAuthPreparado> {
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'invite',
    email: input.email,
    options: {
      data: { role: 'gestor', nome_completo: input.nome, access_role: input.tipo },
      redirectTo: `${appBaseUrl()}/convite/gestor`,
    },
  })
  if (error || !data.user || !data.properties?.hashed_token) {
    throw new Error(error?.message || 'O Supabase Auth nao retornou o usuario convidado.')
  }

  const confirmUrl = new URL('/convite/gestor', appBaseUrl())
  confirmUrl.searchParams.set('token_hash', data.properties.hashed_token)
  confirmUrl.searchParams.set('type', 'invite')
  confirmUrl.searchParams.set('role', input.tipo)

  return {
    userId: data.user.id,
    email: input.email,
    nome: input.nome,
    confirmUrl: confirmUrl.toString(),
    accessRole: input.tipo,
  }
}

export async function enviarConviteUsuarioAuth(input: ConviteUsuarioAuthPreparado & { fundos: string[] }) {
  const nome = escapeHtml(input.nome)
  const confirmUrl = escapeHtml(input.confirmUrl)
  const papel = input.accessRole === 'super_admin' ? 'Super Admin' : 'Gestor'
  const fundosTexto = input.fundos.length > 0 ? input.fundos.join(', ') : 'Nenhum fundo operacional inicial'
  const fundosHtml = input.fundos.length > 0
    ? `<ul>${input.fundos.map((fundo) => `<li>${escapeHtml(fundo)}</li>`).join('')}</ul>`
    : '<p>Nenhum fundo operacional inicial.</p>'
  const result = await enviarEmailOperacional({
    to: input.email,
    subject: `Convite de ${papel} para acessar o BW Antecipa`,
    text: `Voce foi convidado como ${papel} no BW Antecipa. Fundos: ${fundosTexto}. O convite expira em 1 hora. Aceite: ${input.confirmUrl}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#172033">
        <h1 style="font-size:24px">Convite para o BW Antecipa</h1>
        <p>Ola, <strong>${nome}</strong>.</p>
        <p>Voce recebeu um convite para acessar o BW Antecipa como <strong>${papel}</strong>.</p>
        <p><strong>Fundos vinculados:</strong></p>
        ${fundosHtml}
        <p>O link e individual, de uso unico e expira em 1 hora. A abertura da pagina nao confirma o convite.</p>
        <p style="margin:28px 0"><a href="${confirmUrl}" style="background:#125dcc;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Aceitar convite</a></p>
        <p style="font-size:12px;color:#667085">Se voce nao reconhece este convite, ignore esta mensagem.</p>
      </div>
    `,
    idempotencyKey: `convite-usuario-admin:${input.userId}`,
    fromName: 'BETTER WITH',
  })

  if (!result.success) {
    const error = new Error(result.errorMessage || 'Nao foi possivel enviar o convite administrativo.')
    error.name = result.errorCode || 'SMTP_ERROR'
    throw error
  }
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
