import { z } from 'zod'

export const notaFiscalSchema = z.object({
  numero_nf: z.string().min(1, { message: 'Numero da NF e obrigatorio.' }),
  serie: z.string().optional().default(''),
  chave_acesso: z.string().optional().default(''),
  data_emissao: z.string().min(1, { message: 'Data de emissao e obrigatoria.' }),
  data_vencimento: z.string().min(1, { message: 'Data de vencimento e obrigatoria.' }),
  cnpj_emitente: z.string().min(14, { message: 'CNPJ do emitente invalido.' }),
  razao_social_emitente: z.string().min(1, { message: 'Razao social do emitente e obrigatoria.' }),
  cnpj_destinatario: z.string().min(14, { message: 'CNPJ do destinatario invalido.' }),
  razao_social_destinatario: z.string().min(1, { message: 'Razao social do destinatario e obrigatoria.' }),
  valor_bruto: z.coerce.number().positive({ message: 'Valor bruto deve ser positivo.' }),
  valor_liquido: z.coerce.number().min(0).optional().default(0),
  valor_icms: z.coerce.number().min(0).optional().default(0),
  valor_iss: z.coerce.number().min(0).optional().default(0),
  valor_pis: z.coerce.number().min(0).optional().default(0),
  valor_cofins: z.coerce.number().min(0).optional().default(0),
  valor_ipi: z.coerce.number().min(0).optional().default(0),
  descricao_itens: z.string().optional().default(''),
  condicao_pagamento: z.string().optional().default(''),
}).refine((data) => {
  const emissao = new Date(data.data_emissao)
  const hoje = new Date()
  hoje.setHours(23, 59, 59, 999)
  return emissao <= hoje
}, {
  message: 'Data de emissao nao pode ser futura.',
  path: ['data_emissao'],
}).refine((data) => {
  const vencimento = new Date(data.data_vencimento)
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  return vencimento >= hoje
}, {
  message: 'Data de vencimento deve ser futura.',
  path: ['data_vencimento'],
})

export type NotaFiscalFormData = z.infer<typeof notaFiscalSchema>
