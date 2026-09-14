import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { enviarEmailOperacional } from '@/lib/email'

const AUTH_USERS_PAGE_SIZE = 1000
const AUTH_EMAIL_ALREADY_EXISTS_CODES = new Set(['email_exists', 'user_already_exists'])

export type EmailAuthPreflightResult =
  | { outcome: 'AVAILABLE' }
  | { outcome: 'ALREADY_EXISTS' }
  | { outcome: 'LOOKUP_ERROR'; providerCode: string | null; status: number | null }

export type NovoCedenteAuthErrorCode = 'EMAIL_ALREADY_REGISTERED' | 'AUTH_GENERATE_LINK_FAILED'

export class NovoCedenteAuthError extends Error {
  constructor(
    readonly code: NovoCedenteAuthErrorCode,
    readonly providerCode: string | null,
    readonly status: number | null,
  ) {
    super(code)
    this.name = 'NovoCedenteAuthError'
  }
}

function normalizarEmail(email: string) {
  return email.trim().toLowerCase()
}

function detalhesErroAuth(error: unknown) {
  if (!error || typeof error !== 'object') return { providerCode: null, status: null }
  const candidate = error as { code?: unknown; status?: unknown }
  return {
    providerCode: typeof candidate.code === 'string' ? candidate.code : null,
    status: typeof candidate.status === 'number' ? candidate.status : null,
  }
}

function erroIndicaEmailExistente(error: unknown) {
  const { providerCode } = detalhesErroAuth(error)
  return providerCode !== null && AUTH_EMAIL_ALREADY_EXISTS_CODES.has(providerCode.toLowerCase())
}

/**
 * Preflight server-only do fluxo NOVO CEDENTE. A API Admin nao oferece busca
 * pontual por e-mail no SDK, portanto a listagem e percorrida com paginacao e
 * encerrada assim que encontra a identidade ou chega ao fim.
 */
export async function consultarDisponibilidadeEmailNovoCedente(email: string): Promise<EmailAuthPreflightResult> {
  const emailNormalizado = normalizarEmail(email)
  let page = 1

  try {
    const admin = createAdminClient()
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_USERS_PAGE_SIZE })
      if (error) {
        const details = detalhesErroAuth(error)
        return { outcome: 'LOOKUP_ERROR', ...details }
      }

      const users = data?.users || []
      if (users.some((user) => normalizarEmail(user.email || '') === emailNormalizado)) {
        return { outcome: 'ALREADY_EXISTS' }
      }
      if (users.length < AUTH_USERS_PAGE_SIZE) return { outcome: 'AVAILABLE' }

      page += 1
    }
  } catch (error) {
    const details = detalhesErroAuth(error)
    return { outcome: 'LOOKUP_ERROR', ...details }
  }
}

export function gerarTokenConviteNovoCedente() {
  const token = randomBytes(32).toString('hex')
  return { token, tokenHash: hashTokenConviteNovoCedente(token) }
}

export function hashTokenConviteNovoCedente(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function obterAppBaseUrl() {
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

export async function gerarLinkAuthNovoCedente(input: {
  email: string
  appToken: string
}) {
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'invite',
    email: input.email,
    options: {
      data: {
        role: 'cedente',
        nome_completo: input.email.split('@')[0],
        origem: 'convite_novo_cedente',
      },
      redirectTo: `${obterAppBaseUrl()}/auth/confirm`,
    },
  })

  if (error || !data.properties?.hashed_token || !data.user) {
    const details = detalhesErroAuth(error)
    throw new NovoCedenteAuthError(
      erroIndicaEmailExistente(error) ? 'EMAIL_ALREADY_REGISTERED' : 'AUTH_GENERATE_LINK_FAILED',
      details.providerCode,
      details.status,
    )
  }

  const confirmUrl = new URL('/auth/confirm', obterAppBaseUrl())
  confirmUrl.searchParams.set('token_hash', data.properties.hashed_token)
  confirmUrl.searchParams.set('type', 'invite')
  confirmUrl.searchParams.set('invite_token', input.appToken)

  return { confirmUrl: confirmUrl.toString(), userId: data.user.id }
}

export async function enviarEmailConviteNovoCedente(input: {
  email: string
  fundoNome: string
  cnpj: string
  confirmUrl: string
  conviteId: string
}) {
  const fundo = escapeHtml(input.fundoNome)
  const cnpj = escapeHtml(input.cnpj)
  const url = escapeHtml(input.confirmUrl)
  return enviarEmailOperacional({
    to: input.email,
    subject: `Convite para acessar o BW Antecipa - ${input.fundoNome}`,
    text: `Voce foi convidado para cadastrar o Cedente ${input.cnpj} no fundo ${input.fundoNome}. Acesse: ${input.confirmUrl}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#172033">
        <h1 style="font-size:24px">Convite para o BW Antecipa</h1>
        <p>Voce foi convidado para iniciar o cadastro de um Cedente no fundo <strong>${fundo}</strong>.</p>
        <p><strong>CNPJ:</strong> ${cnpj}</p>
        <p>O link e individual, de uso unico e expira em 1 hora.</p>
        <p style="margin:28px 0"><a href="${url}" style="background:#125dcc;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Aceitar convite</a></p>
        <p style="font-size:12px;color:#667085">Se voce nao reconhece este convite, ignore esta mensagem.</p>
      </div>
    `,
    idempotencyKey: `convite-novo-cedente:${input.conviteId}`,
    fromName: 'BETTER WITH',
  })
}
