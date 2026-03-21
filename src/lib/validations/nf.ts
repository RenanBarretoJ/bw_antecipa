import { z } from 'zod'

export const notaFiscalSchema = z.object({
  numero_nf: z.string().min(1, { message: 'Numero da NF e obrigatorio.' }),
  serie: z.string().optional(),
  chave_acesso: z.string().optional(),
  data_emissao: z.string().min(1, { message: 'Data de emissao e obrigatoria.' }),
  data_vencimento: z.string().min(1, { message: 'Data de vencimento e obrigatoria.' }),
  cnpj_emitente: z.string().min(14, { message: 'CNPJ do emitente invalido.' }),
  razao_social_emitente: z.string().min(1, { message: 'Razao social do emitente e obrigatoria.' }),
  cnpj_destinatario: z.string().min(14, { message: 'CNPJ do destinatario invalido.' }),
  razao_social_destinatario: z.string().min(1, { message: 'Razao social do destinatario e obrigatoria.' }),
  valor_bruto: z.number().positive({ message: 'Valor bruto deve ser positivo.' }),
  valor_liquido: z.number().optional(),
  valor_icms: z.number().min(0).optional(),
  valor_iss: z.number().min(0).optional(),
  valor_pis: z.number().min(0).optional(),
  valor_cofins: z.number().min(0).optional(),
  valor_ipi: z.number().min(0).optional(),
  descricao_itens: z.string().optional(),
  condicao_pagamento: z.string().optional(),
})

export type NotaFiscalFormData = z.infer<typeof notaFiscalSchema>
