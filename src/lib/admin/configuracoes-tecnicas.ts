import { z } from 'zod'
import { INTEGRATION_CAPABILITIES, type IntegrationCapability } from '@/lib/integracoes/capabilities'

export type AdminTechnicalNotification = {
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  details?: string
}

export type AdminTechnicalActionResult = {
  success: boolean
  message: string
  data?: { id: string; integrationId?: string; token?: string; tokenDisplay?: string }
  fieldErrors?: Record<string, string[]>
  notification?: AdminTechnicalNotification
}

export type AdminIntegracaoVersao = {
  id: string
  versao: number
  ambiente: 'homologacao' | 'producao'
  status: string
  adapter_key: string | null
  capabilities: IntegrationCapability[]
  active_capabilities: IntegrationCapability[]
  identificador_cliente: string
  codigo_originador: string | null
  endpoint_base: string
  configuracao_nao_sensivel: Record<string, unknown>
  credencial_integracao_id: string | null
  vigente_desde: string
  vigente_ate: string | null
  publicada_em: string | null
  created_at: string
  updated_at: string
}

export type AdminIntegracao = {
  id: string
  provedor: string
  provider_key: string
  system_name: string
  nome: string
  status: string
  created_at: string
  updated_at: string
  versoes: AdminIntegracaoVersao[]
}

export type AdminCredencialIntegracao = {
  id: string
  integracao_fundo_id: string
  ambiente: 'homologacao' | 'producao'
  nome: string
  status: AdminCredencialStatus
  chave_versao: string
  criada_em: string
  ativada_em: string | null
  revogada_em: string | null
  substituida_por: string | null
  ultimo_uso_em: string | null
  usuario_mascarado: string | null
  created_at: string
  updated_at: string
}

export type AdminCredencialStatus = 'rascunho' | 'ativa' | 'substituida' | 'revogada'
export type AdminCredencialAcao = 'ativar' | 'rotacionar' | 'revogar'

export function obterAcoesCredencial(status: AdminCredencialStatus): AdminCredencialAcao[] {
  if (status === 'rascunho') return ['ativar']
  if (status === 'ativa') return ['rotacionar', 'revogar']
  return []
}

export type AdminCnabVersao = {
  id: string
  versao: number
  status: string
  layout: 'cnab444'
  versao_layout: string
  codigo_banco: string
  banco: string
  agencia: string
  conta: string
  digito_conta: string
  carteira: string
  convenio: string
  codigo_originador: string
  codigo_empresa: string
  tipo_inscricao: string
  numero_inscricao: string
  especie_titulo: string
  tipo_recebivel: string
  configuracao: Record<string, unknown>
  conteudo_hash: string
  vigente_desde: string
  vigente_ate: string | null
  publicada_em: string | null
  created_at: string
  updated_at: string
}

export type AdminCnabConfiguracao = {
  id: string
  codigo: string
  nome: string
  descricao: string | null
  finalidade: string
  status: string
  created_at: string
  updated_at: string
  versoes: AdminCnabVersao[]
}

export type AdminIntegracaoExecucao = {
  id: string
  integracao_fundo_versao_id: string
  tipo_execucao: string
  ambiente: string
  status: string
  tentativa: number
  codigo_resposta: string | null
  mensagem_resumida: string | null
  erro_categoria: string | null
  duracao_ms: number | null
  iniciada_em: string
  finalizada_em: string | null
}

export type AdminConfiguracoesTecnicasFundo = {
  fundo: { id: string; nome: string; cnpj: string; ativo: boolean }
  integracoes: AdminIntegracao[]
  credenciais: AdminCredencialIntegracao[]
  cnab: AdminCnabConfiguracao[]
  execucoes: AdminIntegracaoExecucao[]
  execucoes_total: number
}

// PostgreSQL aceita o formato canonico do tipo uuid sem exigir os bits de
// versao e variante da RFC. Parte dos IDs legados do projeto usa esse formato.
const POSTGRES_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuidComMensagem = (message: string) => z.string().trim().regex(POSTGRES_UUID_PATTERN, message)
const uuid = uuidComMensagem('Identificador invalido.')
const mfaCode = z.string().regex(/^\d{6}$/, 'Informe o codigo TOTP de 6 digitos.')
const ambiente = z.enum(['homologacao', 'producao'])
const jsonObject = z.record(z.string(), z.unknown())

const endpointRascunho = z.string().trim().max(1000).default('').superRefine((value, context) => {
  if (!value) return
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      context.addIssue({ code: 'custom', message: 'Informe uma URL HTTP ou HTTPS valida, sem credenciais.' })
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'A URL do endpoint nao e valida.' })
  }
})

const credencialOpcional = z.preprocess(
  (value) => value === '' || value === null || value === undefined ? null : value,
  uuid.nullable(),
)

export const adminCredencialSchema = z.object({
  fundoId: uuid,
  integracaoFundoId: uuid,
  ambiente,
  nome: z.string().trim().min(2).max(120),
  usuario: z.string().trim().min(1).max(300),
  senha: z.string().min(1).max(1000),
  credencialAnteriorId: uuid.nullable().optional(),
  mfaCode,
})

export const adminIntegracaoRascunhoSchema = z.object({
  fundoId: uuidComMensagem('FUNDO_ID_INVALIDO'),
  integracaoFundoId: uuidComMensagem('INTEGRACAO_ID_INVALIDO').nullable().optional(),
  versaoId: uuidComMensagem('VERSAO_ID_INVALIDO').nullable().optional(),
  providerKey: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  systemName: z.string().trim().min(2).max(160),
  adapterKey: z.preprocess((value) => value === '' || value == null ? null : value, z.string().trim().regex(/^[a-z][a-z0-9_]{1,79}$/).nullable()),
  capabilities: z.array(z.enum(INTEGRATION_CAPABILITIES)).default([]),
  ambiente,
  endpointBase: endpointRascunho,
  identificadorCliente: z.string().trim().max(200).default(''),
  credencialIntegracaoId: credencialOpcional,
  configuracaoNaoSensivel: jsonObject.default({}),
  updatedAtEsperado: z.iso.datetime().nullable().optional(),
})

export const adminCnabRascunhoSchema = z.object({
  fundoId: uuid,
  configuracaoId: uuid.nullable().optional(),
  versaoId: uuid.nullable().optional(),
  codigo: z.string().trim().regex(/^[a-z0-9_-]+$/).max(80),
  nome: z.string().trim().min(2).max(200),
  descricao: z.string().trim().max(500).nullable().optional(),
  layout: z.literal('cnab444'),
  versaoLayout: z.string().trim().min(1).max(40),
  codigoBanco: z.string().trim().min(1).max(20),
  banco: z.string().trim().min(1).max(120),
  agencia: z.string().trim().min(1).max(30),
  conta: z.string().trim().min(1).max(40),
  digitoConta: z.string().trim().max(10),
  carteira: z.string().trim().min(1).max(30),
  convenio: z.string().trim().min(1).max(60),
  codigoOriginador: z.string().trim().regex(/^\d{1,20}$/),
  codigoEmpresa: z.string().trim().min(1).max(60),
  tipoInscricao: z.string().trim().min(1).max(20),
  numeroInscricao: z.string().trim().min(1).max(30),
  especieTitulo: z.string().trim().min(1).max(30),
  tipoRecebivel: z.string().trim().min(1).max(30),
  configuracao: jsonObject.default({}),
  updatedAtEsperado: z.iso.datetime().nullable().optional(),
})

export type IntegracaoPublicavel = Pick<
  AdminIntegracaoVersao,
  'ambiente' | 'endpoint_base' | 'identificador_cliente' | 'codigo_originador' | 'credencial_integracao_id' | 'adapter_key' | 'capabilities'
>

export function obterPendenciaPublicacaoIntegracao(
  versao: IntegracaoPublicavel,
  credenciais: AdminCredencialIntegracao[],
  requirements: { requiresEndpoint: boolean; requiresCredential: boolean } = {
    requiresEndpoint: true,
    requiresCredential: true,
  },
): string | null {
  if (!versao.adapter_key) return 'Esta integracao ainda nao possui adapter implementado.'
  if (versao.capabilities.length === 0) return 'Selecione ao menos uma capability antes de publicar.'
  if (requirements.requiresEndpoint) {
    if (!versao.endpoint_base.trim()) return 'Informe o endpoint HTTPS antes de publicar.'
    try {
      if (new URL(versao.endpoint_base).protocol !== 'https:') return 'Informe o endpoint HTTPS antes de publicar.'
    } catch {
      return 'Informe um endpoint HTTPS valido antes de publicar.'
    }
  }
  if (requirements.requiresCredential) {
    if (!versao.credencial_integracao_id) return 'Selecione uma credencial ativa antes de publicar.'
    const credencial = credenciais.find((item) => item.id === versao.credencial_integracao_id)
    if (!credencial || credencial.status !== 'ativa' || credencial.ambiente !== versao.ambiente) {
      return 'Selecione uma credencial ativa compativel com o ambiente antes de publicar.'
    }
  }
  return null
}

export const adminTechnicalConfirmationSchema = z.object({
  fundoId: uuid,
  id: uuid,
  mfaCode,
  motivo: z.string().trim().max(500).optional(),
})

export function mascararIdentificador(value: string) {
  const trimmed = value.trim()
  if (trimmed.length <= 4) return '*'.repeat(trimmed.length)
  return `${trimmed.slice(0, 2)}${'*'.repeat(Math.min(8, trimmed.length - 4))}${trimmed.slice(-2)}`
}
