import { z } from 'zod'
import { validarCNPJ } from '@/lib/validations/cedente'

export const criarCedenteConsultorSchema = z.object({
  fundoId: z.uuid('Selecione um fundo válido.'),
  cnpj: z.string().trim()
    .refine(validarCNPJ, 'Informe um CNPJ válido.')
    .transform((value) => value.replace(/\D/g, '')),
  razaoSocial: z.string().trim().min(3, 'Informe a Razão Social.').max(200),
  nomeFantasia: z.string().trim().max(200).optional().default(''),
})

export type FundoCriacaoCedente = { id: string; nome: string; cnpj: string }

export type CedenteGerenciado = {
  id: string
  razao_social: string
  nome_fantasia: string | null
  cnpj: string
  status: string
  vinculo_status: string
  fundo_id: string
  fundo_nome: string
  onboarding_concluido_em: string | null
  documentos_pendentes: number
  total_count: number
}

export type CriarCedenteConsultorResult = {
  success: boolean
  message: string
  cedenteId?: string
  fieldErrors?: Record<string, string[]>
}
