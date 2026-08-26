'use server'

import { requireGestor } from '@/lib/auth/authorization'
import {
  mensagemFalhaEnvioConvite,
  novoCedenteInviteSchema,
  type NovoCedenteInviteInput,
} from '@/lib/auth/novo-cedente-invite'
import {
  enviarEmailConviteNovoCedente,
  gerarLinkAuthNovoCedente,
  gerarTokenConviteNovoCedente,
} from '@/lib/auth/novo-cedente-invite.server'

export type ConviteNovoCedenteResult = {
  success: boolean
  message: string
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
    message?: string | null,
  ) {
    super(message || code)
    this.name = 'ConviteEnvioError'
  }
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
      throw new ConviteEnvioError(
        'AUTH_LINK_ERROR',
        authError instanceof Error ? authError.message : 'Falha ao gerar link Auth.',
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
      p_motivo: 'falha_geracao_ou_envio_email',
      p_correlation_id: correlationId,
    })
    console.error('[convite-novo-cedente]', {
      etapa: 'enviar_convite',
      convite_id: convite.convite_id,
      correlation_id: correlationId,
      cancelamento_falhou: Boolean(cancelError),
      codigo: sendErrorCode,
      erro: sendError instanceof Error ? sendError.message : 'falha_desconhecida',
    })
    return { success: false, message: mensagemFalhaEnvioConvite(sendErrorCode) }
  }

  return {
    success: true,
    message: `Convite enviado para ${convite.email}. O link expira em 1 hora.`,
  }
}
