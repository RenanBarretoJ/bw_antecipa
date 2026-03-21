import { z } from 'zod'

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, { message: 'E-mail e obrigatorio.' })
    .email({ message: 'E-mail invalido.' }),
  password: z
    .string()
    .min(8, { message: 'A senha deve ter no minimo 8 caracteres.' })
    .regex(/[A-Z]/, { message: 'A senha deve conter pelo menos 1 letra maiuscula.' })
    .regex(/[0-9]/, { message: 'A senha deve conter pelo menos 1 numero.' })
    .regex(/[^a-zA-Z0-9]/, { message: 'A senha deve conter pelo menos 1 caractere especial.' }),
})

export const cadastroSchema = z.object({
  nome_completo: z
    .string()
    .min(3, { message: 'O nome deve ter no minimo 3 caracteres.' }),
  email: z
    .string()
    .min(1, { message: 'E-mail e obrigatorio.' })
    .email({ message: 'E-mail invalido.' }),
  password: z
    .string()
    .min(8, { message: 'A senha deve ter no minimo 8 caracteres.' })
    .regex(/[A-Z]/, { message: 'A senha deve conter pelo menos 1 letra maiuscula.' })
    .regex(/[0-9]/, { message: 'A senha deve conter pelo menos 1 numero.' })
    .regex(/[^a-zA-Z0-9]/, { message: 'A senha deve conter pelo menos 1 caractere especial.' }),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'As senhas nao conferem.',
  path: ['confirmPassword'],
})

export type LoginFormData = z.infer<typeof loginSchema>
export type CadastroFormData = z.infer<typeof cadastroSchema>
