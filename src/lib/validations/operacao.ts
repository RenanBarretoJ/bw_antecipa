import { z } from 'zod'

export const operacaoSchema = z.object({
  nota_fiscal_ids: z.array(z.string()).min(1, { message: 'Selecione pelo menos uma nota fiscal.' }),
  taxa_desconto: z.number().min(0, { message: 'Taxa deve ser positiva.' }),
  prazo_dias: z.number().int().positive({ message: 'Prazo deve ser positivo.' }),
  data_vencimento: z.string().min(1, { message: 'Data de vencimento e obrigatoria.' }),
})

export const operacaoAnaliseSchema = z.object({
  status: z.enum(['aprovada', 'reprovada'], { message: 'Status invalido.' }),
  motivo_reprovacao: z.string().optional(),
}).refine(
  (data) => data.status !== 'reprovada' || (data.motivo_reprovacao && data.motivo_reprovacao.length > 0),
  { message: 'Motivo da reprovacao e obrigatorio.', path: ['motivo_reprovacao'] }
)

export type OperacaoFormData = z.infer<typeof operacaoSchema>
export type OperacaoAnaliseFormData = z.infer<typeof operacaoAnaliseSchema>
