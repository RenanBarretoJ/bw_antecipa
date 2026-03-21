import { z } from 'zod'

export const documentoUploadSchema = z.object({
  tipo: z.enum([
    'contrato_social',
    'cartao_cnpj',
    'rg_cpf',
    'comprovante_endereco',
    'extrato_bancario',
    'balanco_patrimonial',
    'dre',
    'procuracao',
  ], { message: 'Tipo de documento invalido.' }),
  arquivo: z.instanceof(File, { message: 'Arquivo e obrigatorio.' }),
})

export const documentoAnaliseSchema = z.object({
  status: z.enum(['aprovado', 'reprovado'], { message: 'Status invalido.' }),
  motivo_reprovacao: z.string().optional(),
}).refine(
  (data) => data.status !== 'reprovado' || (data.motivo_reprovacao && data.motivo_reprovacao.length > 0),
  { message: 'Motivo da reprovacao e obrigatorio.', path: ['motivo_reprovacao'] }
)

export type DocumentoUploadFormData = z.infer<typeof documentoUploadSchema>
export type DocumentoAnaliseFormData = z.infer<typeof documentoAnaliseSchema>
