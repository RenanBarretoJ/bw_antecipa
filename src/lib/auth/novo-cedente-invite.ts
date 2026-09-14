import { z } from 'zod'
import { validarCnpjServer } from '@/lib/cadastro/cnpj.server'

export const novoCedenteInviteSchema = z.object({
  fundoId: z.string().uuid('Fundo invalido.'),
  cnpj: z.string()
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => validarCnpjServer(value), 'CNPJ invalido.'),
  email: z.string().trim().toLowerCase().email('E-mail invalido.'),
})

export const aceitarNovoCedenteInviteSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/i, 'Convite invalido.'),
  password: z.string()
    .min(8, 'A senha deve ter no minimo 8 caracteres.')
    .regex(/[A-Z]/, 'A senha deve conter pelo menos 1 letra maiuscula.')
    .regex(/[0-9]/, 'A senha deve conter pelo menos 1 numero.')
    .regex(/[^a-zA-Z0-9]/, 'A senha deve conter pelo menos 1 caractere especial.'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'As senhas nao conferem.',
  path: ['confirmPassword'],
})

export type NovoCedenteInviteInput = z.input<typeof novoCedenteInviteSchema>

export type ConviteNovoCedenteErrorCode =
  | 'EMAIL_ALREADY_REGISTERED'
  | 'AUTH_LOOKUP_FAILED'
  | 'AUTH_GENERATE_LINK_FAILED'
  | 'EMAIL_DISABLED'
  | 'SMTP_CONFIG_INVALID'
  | 'SMTP_EAUTH'
  | 'SMTP_535'
  | 'SMTP_RECIPIENT_REJECTED'
  | 'SMTP_550'
  | 'SMTP_553'
  | 'SMTP_ERROR'

export const EMAIL_NOVO_CEDENTE_JA_CADASTRADO =
  'Este e-mail já está cadastrado na plataforma. Para cadastrar um novo Cedente/CNPJ, informe um novo e-mail para o responsável.'

export const EMAIL_NOVO_CEDENTE_NAO_VALIDADO =
  'Não foi possível validar o e-mail no serviço de autenticação. Tente novamente em alguns instantes.'

export function mensagemFalhaEnvioConvite(codigo: string): string {
  if (codigo === 'EMAIL_ALREADY_REGISTERED') {
    return EMAIL_NOVO_CEDENTE_JA_CADASTRADO
  }
  if (codigo === 'AUTH_LOOKUP_FAILED') {
    return EMAIL_NOVO_CEDENTE_NAO_VALIDADO
  }
  if (codigo === 'EMAIL_DISABLED') {
    return 'O envio de e-mail nao esta configurado neste ambiente. Nenhum Cedente foi criado.'
  }
  if (codigo === 'SMTP_CONFIG_INVALID') {
    return 'A configuracao do servidor de e-mail esta invalida. Nenhum Cedente foi criado.'
  }
  if (codigo === 'SMTP_EAUTH' || codigo === 'SMTP_535') {
    return 'Nao foi possivel autenticar no servidor de e-mail. Nenhum Cedente foi criado.'
  }
  if (codigo === 'SMTP_RECIPIENT_REJECTED' || codigo === 'SMTP_550' || codigo === 'SMTP_553') {
    return 'O servidor de e-mail recusou o destinatario informado. Nenhum Cedente foi criado.'
  }
  if (codigo === 'AUTH_LINK_ERROR' || codigo === 'AUTH_GENERATE_LINK_FAILED') {
    return 'Nao foi possivel preparar o acesso do usuario no Supabase Auth. Nenhum Cedente foi criado.'
  }
  return 'Nao foi possivel enviar o convite. Nenhum Cedente foi criado.'
}

export function mensagemAceiteConvite(codigo: string): string {
  const mensagens: Record<string, string> = {
    CONVITE_EXPIRADO: 'Este convite expirou. Solicite um novo convite ao gestor.',
    CONVITE_JA_UTILIZADO: 'Este convite ja foi utilizado ou cancelado.',
    CONVITE_EMAIL_DIVERGENTE: 'O convite pertence a outro e-mail. Entre com o e-mail que recebeu o convite.',
    CNPJ_JA_CADASTRADO: 'O CNPJ deste convite ja pertence a outro Cedente.',
    USUARIO_JA_VINCULADO: 'Este usuario ja esta vinculado a uma organizacao Cedente.',
    FUNDO_INDISPONIVEL: 'O fundo do convite nao esta mais disponivel. Solicite um novo convite.',
    CONVITE_INVALIDO: 'Convite invalido. Solicite um novo convite ao gestor.',
  }
  return mensagens[codigo] || 'Nao foi possivel aceitar o convite. Solicite um novo convite ao gestor.'
}
