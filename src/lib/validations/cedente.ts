import { z } from 'zod'

export const cedenteSchema = z.object({
  cnpj: z.string().min(14, { message: 'CNPJ invalido.' }),
  razao_social: z.string().min(3, { message: 'Razao social e obrigatoria.' }),
  nome_fantasia: z.string().optional(),
  cep: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
  telefone_comercial: z.string().optional(),
  email_comercial: z.string().email({ message: 'E-mail comercial invalido.' }).optional().or(z.literal('')),
  cnae: z.string().optional(),
  nome_representante: z.string().optional(),
  cpf_representante: z.string().optional(),
  rg_representante: z.string().optional(),
  cargo_representante: z.string().optional(),
  email_representante: z.string().email({ message: 'E-mail do representante invalido.' }).optional().or(z.literal('')),
  telefone_representante: z.string().optional(),
  banco: z.string().optional(),
  agencia: z.string().optional(),
  conta: z.string().optional(),
  tipo_conta: z.enum(['corrente', 'poupanca']).optional(),
})

export type CedenteFormData = z.infer<typeof cedenteSchema>
