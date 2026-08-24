import { z } from 'zod'
import type { AdminTechnicalActionResult } from '@/lib/admin/configuracoes-tecnicas'

const POSTGRES_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = z.string().trim().regex(POSTGRES_UUID_PATTERN, 'Identificador invalido.')
const uuidOpcional = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? null : value),
  uuid.nullable(),
)
const mfaCode = z.string().regex(/^\d{6}$/, 'Informe o codigo TOTP de 6 digitos.')
const providerPattern = /^[a-z0-9_-]{2,64}$/

export type { AdminTechnicalActionResult }

export const WEBHOOK_EVENTO_STATUSES = [
  'RECEBIDO', 'PROCESSANDO', 'PROCESSADO', 'DUPLICADO', 'NAO_IDENTIFICADO',
  'REVISAO_MATCH', 'IGNORADO_CANHOTO_JA_APROVADO', 'AGUARDANDO_ENTREGA',
  'ERRO_REPROCESSAVEL', 'ERRO_FINAL', 'EVIDENCIA_INDISPONIVEL',
] as const
export type WebhookEventoStatus = (typeof WEBHOOK_EVENTO_STATUSES)[number]

export const WEBHOOK_EVENTO_STATUSES_REPROCESSAVEIS = ['NAO_IDENTIFICADO', 'REVISAO_MATCH', 'ERRO_REPROCESSAVEL'] as const

export function statusPodeSerReprocessado(status: string): boolean {
  return (WEBHOOK_EVENTO_STATUSES_REPROCESSAVEIS as readonly string[]).includes(status)
}

export type AdminIntegracaoTransportadora = {
  id: string
  fundo_id: string
  nome_fundo: string
  provider: string
  nome: string | null
  cnpj_transportadora: string | null
  ativo: boolean
  created_at: string
  token_status: 'ativo' | 'substituido' | 'revogado' | null
  token_display: string | null
  token_criado_em: string | null
  ultimo_recebimento_em: string | null
  ultimo_processamento_ok_em: string | null
  eventos_com_erro_7d: number
}

export type AdminWebhookEventoResumo = {
  id: string
  recebido_em: string
  processado_em: string | null
  provider: string
  fundo_id: string
  integracao_id: string
  chave_nfe: string | null
  chave_cte: string | null
  status: WebhookEventoStatus
  nota_fiscal_venda_id: string | null
  nota_fiscal_remessa_id: string | null
  match_metodo: string | null
  erro_codigo: string | null
  erro_detalhe: string | null
  evidencia_retida: boolean
}

export type AdminWebhookEventoDetalhe = AdminWebhookEventoResumo & {
  external_event_id: string | null
  tentativa_count: number
  persisted_at: string | null
  cnpj_cliente: string | null
  cnpj_emitente: string | null
  cnpj_transportadora: string | null
  data_emissao_nfe: string | null
  data_entrega_nfe: string | null
  content_type: string | null
  cte_id: string | null
  tipo_vinculo: string | null
  match_confianca: string | null
  canhoto_id: string | null
}

export type AdminWebhookEventosListResult = {
  items: AdminWebhookEventoResumo[]
  total: number
  limit: number
  offset: number
}

export type AdminWebhookEventosFiltro = {
  fundoId?: string | null
  integracaoId?: string | null
  status?: string | null
  chaveNfe?: string | null
  chaveCte?: string | null
  desde?: string | null
  ate?: string | null
  pagina: number
  porPagina: number
}

export function mascararTokenDisplay(tokenDisplay: string | null): string {
  if (!tokenDisplay) return '----'
  return `•••• ${tokenDisplay}`
}

export const adminCriarIntegracaoTransportadoraSchema = z.object({
  fundoId: uuid,
  provider: z.string().trim().toLowerCase().regex(providerPattern, 'Use apenas letras minusculas, digitos, hifen e underscore (2-64 caracteres).'),
  nome: z.string().trim().max(120).optional(),
  cnpjTransportadora: z.string().trim().optional(),
  mfaCode,
})

export const adminIntegracaoTransportadoraConfirmationSchema = z.object({
  id: uuid,
  mfaCode,
})

export const adminRevogarTokenTransportadoraSchema = z.object({
  id: uuid,
  motivo: z.string().trim().max(500).optional(),
  mfaCode,
})

export const adminReprocessarWebhookEventoSchema = z.object({
  id: uuid,
  mfaCode,
})

export const adminIntegracaoTransportadoraTokenResult = z.object({
  token: z.string(),
  token_display: z.string(),
})

export type AdminIntegracaoTransportadoraTokenResult = { token: string; tokenDisplay: string }

export const adminWebhookEventosFiltroSchema = z.object({
  fundoId: uuidOpcional,
  integracaoId: uuidOpcional,
  status: z.string().trim().optional(),
  chaveNfe: z.string().trim().optional(),
  chaveCte: z.string().trim().optional(),
  desde: z.string().trim().optional(),
  ate: z.string().trim().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
})

const WEBHOOK_EVENTOS_PAGE_SIZE = 25

export function parseAdminWebhookEventosFiltro(
  searchParams: Record<string, string | string[] | undefined>,
): AdminWebhookEventosFiltro {
  const get = (key: string): string => {
    const value = searchParams[key]
    return (Array.isArray(value) ? value[0] : value) || ''
  }
  const paginaBruta = Number(get('pagina') || '1')
  return {
    fundoId: get('fundoId') || null,
    integracaoId: get('integracaoId') || null,
    status: get('status') || null,
    chaveNfe: get('chaveNfe') || null,
    chaveCte: get('chaveCte') || null,
    desde: get('desde') || null,
    ate: get('ate') || null,
    pagina: Number.isFinite(paginaBruta) && paginaBruta > 0 ? Math.floor(paginaBruta) : 1,
    porPagina: WEBHOOK_EVENTOS_PAGE_SIZE,
  }
}
