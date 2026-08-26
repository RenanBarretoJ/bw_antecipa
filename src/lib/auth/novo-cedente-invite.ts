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
