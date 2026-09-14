'use server'

import { requireGestor } from '@/lib/auth/authorization'
import {
  mensagemFalhaEnvioConvite,
  novoCedenteInviteSchema,
  type NovoCedenteInviteInput,
} from '@/lib/auth/novo-cedente-invite'
import {
  consultarDisponibilidadeEmailNovoCedente,
  enviarEmailConviteNovoCedente,
  gerarLinkAuthNovoCedente,
  gerarTokenConviteNovoCedente,
  NovoCedenteAuthError,
} from '@/lib/auth/novo-cedente-invite.server'
import { resolverFundoAtivoOnboarding } from '@/lib/onboarding-cedentes/contexto.server'

export type ConviteNovoCedenteResult = {
  success: boolean
  message: string
  code?: string
  errors?: Record<string, string[]>
}

type ConviteCriado = {
  convite_id: string
  fundo_id: string
  fundo_nome: string
  cnpj: string
  email: string
  expires_at: string
}

class ConviteEnvioError extends Error {
  constructor(
    readonly code: string,
    readonly providerCode: string | null = null,
    readonly status: number | null = null,
  ) {
    super(code)
    this.name = 'ConviteEnvioError'
  }
}

function motivoCancelamentoConvite(codigo: string) {
  if (codigo === 'EMAIL_ALREADY_REGISTERED') return 'email_already_registered'
  if (codigo === 'AUTH_GENERATE_LINK_FAILED') return 'auth_generate_link_failed'
  return 'email_send_failed'
}

function mensagemErroConvite(codigo: string | undefined, mensagem: string | undefined) {
  if (codigo === '23505') return mensagem || 'CNPJ ou e-mail ja possui convite pendente.'
  if (codigo === '22023' || codigo === '42501') return mensagem || 'Dados do convite invalidos.'
  return 'Nao foi possivel criar o convite. Tente novamente.'
}

export async function convidarNovoCedente(input: NovoCedenteInviteInput): Promise<ConviteNovoCedenteResult> {
  const context = await requireGestor()
  const validated = novoCedenteInviteSchema.safeParse(input)
  if (!validated.success) {
    return {
      success: false,
      message: 'Revise os dados do convite.',
      errors: validated.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const correlationId = crypto.randomUUID()
  const fundoAtivo = await resolverFundoAtivoOnboarding(context)
  if (!fundoAtivo || fundoAtivo.id !== validated.data.fundoId) {
    return { success: false, message: 'O fundo informado nao corresponde ao fundo ativo autorizado.' }
  }

  const emailPreflight = await consultarDisponibilidadeEmailNovoCedente(validated.data.email)
  console.info('[convite-novo-cedente]', {
    etapa: 'auth_email_preflight',
    correlation_id: correlationId,
    outcome: emailPreflight.outcome.toLowerCase(),
    provider_code: emailPreflight.outcome === 'LOOKUP_ERROR' ? emailPreflight.providerCode : null,
    http_status: emailPreflight.outcome === 'LOOKUP_ERROR' ? emailPreflight.status : null,
  })
  if (emailPreflight.outcome === 'ALREADY_EXISTS') {
    return {
      success: false,
      code: 'EMAIL_ALREADY_REGISTERED',
      message: mensagemFalhaEnvioConvite('EMAIL_ALREADY_REGISTERED'),
    }
  }
  if (emailPreflight.outcome === 'LOOKUP_ERROR') {
    return {
      success: false,
      code: 'AUTH_LOOKUP_FAILED',
      message: mensagemFalhaEnvioConvite('AUTH_LOOKUP_FAILED'),
    }
  }

  const { token, tokenHash } = gerarTokenConviteNovoCedente()
  const { data, error } = await context.supabase.rpc('criar_convite_novo_cedente', {
    p_fundo_id: validated.data.fundoId,
    p_cnpj: validated.data.cnpj,
    p_email: validated.data.email,
    p_token_hash: tokenHash,
    p_correlation_id: correlationId,
  })

  if (error || !data) {
    return { success: false, message: mensagemErroConvite(error?.code, error?.message) }
  }

  const convite = data as ConviteCriado

  try {
    let authLink: Awaited<ReturnType<typeof gerarLinkAuthNovoCedente>>
    try {
      authLink = await gerarLinkAuthNovoCedente({ email: convite.email, appToken: token })
    } catch (authError) {
      if (authError instanceof NovoCedenteAuthError) {
        throw new ConviteEnvioError(authError.code, authError.providerCode, authError.status)
      }
      throw new ConviteEnvioError(
        'AUTH_GENERATE_LINK_FAILED',
      )
    }
    const email = await enviarEmailConviteNovoCedente({
      email: convite.email,
      fundoNome: convite.fundo_nome,
      cnpj: convite.cnpj,
      confirmUrl: authLink.confirmUrl,
      conviteId: convite.convite_id,
    })

    if (!email.success) throw new ConviteEnvioError(email.errorCode || 'SMTP_ERROR', email.errorMessage)
  } catch (sendError) {
    const sendErrorCode = sendError instanceof ConviteEnvioError ? sendError.code : 'SMTP_ERROR'
    const { error: cancelError } = await context.supabase.rpc('cancelar_convite_novo_cedente', {
      p_convite_id: convite.convite_id,
      p_motivo: motivoCancelamentoConvite(sendErrorCode),
      p_correlation_id: correlationId,
    })
    console.error('[convite-novo-cedente]', {
      etapa: 'enviar_convite',
      convite_id: convite.convite_id,
      correlation_id: correlationId,
      cancelamento_falhou: Boolean(cancelError),
      codigo: sendErrorCode,
      provider_code: sendError instanceof ConviteEnvioError ? sendError.providerCode : null,
      http_status: sendError instanceof ConviteEnvioError ? sendError.status : null,
    })
    return { success: false, code: sendErrorCode, message: mensagemFalhaEnvioConvite(sendErrorCode) }
  }

  return {
    success: true,
    message: `Convite enviado para ${convite.email}. O link expira em 1 hora.`,
  }
}
