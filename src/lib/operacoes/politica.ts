import { createHash } from 'node:crypto'
import type {
  CedenteFundo,
  Fundo,
  PoliticaOperacional,
  PoliticaOperacionalVersao,
  PoliticaRequisitoDocumental,
} from '@/types/database'
import { requireCedenteAccess, type AppSupabaseClient } from '@/lib/auth/authorization'
import { CedenteFundoError, assertFundoAtivo, resolverCedenteFundoAtivo } from '@/lib/fundos/cedente-fundo'

export interface PoliticaResolvida {
  cedenteFundo: CedenteFundo
  fundo: Fundo
  politica: PoliticaOperacional
  versao: PoliticaOperacionalVersao
  requisitos: PoliticaRequisitoDocumental[]
}

export interface PoliticaSnapshot {
  schema: 'bw-antecipa.politica-operacional.v1'
  cedente_fundo_id: string
  fundo_id: string
  politica_operacional_id: string
  politica_operacional_versao_id: string
  politica_versao: number
  aceite_sacado_obrigatorio: boolean
  cessao_no_desembolso: boolean
  cria_acompanhamento_entrega: boolean
  configuracao: Record<string, unknown>
  requisitos: Array<{
    codigo: string
    escopo: string
    tipo_documento_codigo: string
    obrigatorio: boolean
    quantidade_minima: number
    formatos_aceitos: string[]
    nivel_validacao: string
    prazo_dias_corridos: number | null
    responsavel_upload: string
    responsavel_aprovacao: string
    ordem: number
    ativo: boolean
  }>
}

const SECRET_KEY = /(secret|password|senha|token|api[_-]?key|credential|private[_-]?key|banco|bank|agencia|agency|conta|account|routing|pix|payload|raw[_-]?body|webhook)/i

function assertNoSecretKeys(value: unknown, path = 'configuracao'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretKeys(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      throw new Error(`A politica nao pode armazenar segredo em ${path}.${key}.`)
    }
    assertNoSecretKeys(child, `${path}.${key}`)
  }
}

export function validarConfiguracaoPublica(value: unknown): void {
  assertNoSecretKeys(value)
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  )
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

export function criarSnapshotPolitica(policy: PoliticaResolvida): { snapshot: PoliticaSnapshot; hash: string } {
  assertNoSecretKeys(policy.versao.configuracao)

  const snapshot: PoliticaSnapshot = {
    schema: 'bw-antecipa.politica-operacional.v1',
    cedente_fundo_id: policy.cedenteFundo.id,
    fundo_id: policy.fundo.id,
    politica_operacional_id: policy.politica.id,
    politica_operacional_versao_id: policy.versao.id,
    politica_versao: policy.versao.versao,
    aceite_sacado_obrigatorio: policy.versao.aceite_sacado_obrigatorio,
    cessao_no_desembolso: policy.versao.cessao_no_desembolso,
    cria_acompanhamento_entrega: policy.versao.cria_acompanhamento_entrega,
    configuracao: policy.versao.configuracao,
    requisitos: [...policy.requisitos]
      .sort((left, right) => left.ordem - right.ordem || left.codigo.localeCompare(right.codigo))
      .map((requirement) => ({
        codigo: requirement.codigo,
        escopo: requirement.escopo,
        tipo_documento_codigo: requirement.tipo_documento_codigo,
        obrigatorio: requirement.obrigatorio,
        quantidade_minima: requirement.quantidade_minima,
        formatos_aceitos: [...requirement.formatos_aceitos],
        nivel_validacao: requirement.nivel_validacao,
        prazo_dias_corridos: requirement.prazo_dias_corridos,
        responsavel_upload: requirement.responsavel_upload,
        responsavel_aprovacao: requirement.responsavel_aprovacao,
        ordem: requirement.ordem,
        ativo: requirement.ativo,
      })),
  }

  const hash = createHash('sha256').update(stableStringify(snapshot)).digest('hex')
  return { snapshot, hash }
}

export function statusAceiteInicial(exigeAceite: boolean): 'pendente' | 'dispensado' {
  return exigeAceite ? 'pendente' : 'dispensado'
}

export function validarContextoOperacional(policy: PoliticaResolvida): void {
  if (policy.cedenteFundo.status !== 'ativo' || policy.fundo.ativo !== true) {
    throw new CedenteFundoError('O vinculo e o fundo precisam estar ativos.', 'POLITICA_CONTEXT_NOT_CONFIGURED')
  }
  if (policy.politica.status !== 'ativa' || !policy.versao.publicada_em || policy.versao.versao < 1) {
    throw new CedenteFundoError('A politica precisa estar ativa e publicada.', 'POLITICA_CONTEXT_NOT_CONFIGURED')
  }
}

async function carregarPoliticaResolvida(
  supabase: AppSupabaseClient,
  cedenteFundo: CedenteFundo,
  fundo: Fundo,
): Promise<PoliticaResolvida> {
  const { data: policies, error: policyError } = await supabase
    .from('politicas_operacionais')
    .select('*')
    .eq('cedente_fundo_id', cedenteFundo.id)
    .eq('status', 'ativa')

  if (policyError) throw new Error(`Erro ao buscar politica operacional: ${policyError.message}`)
  if (!policies || policies.length !== 1) {
    throw new CedenteFundoError(
      'Nao existe exatamente uma politica operacional ativa para o vinculo cedente-fundo.',
      'POLITICA_CONTEXT_NOT_CONFIGURED',
    )
  }

  const politica = policies[0] as PoliticaOperacional
  const now = new Date().toISOString()
  const { data: versions, error: versionError } = await supabase
    .from('politica_operacional_versoes')
    .select('*')
    .eq('politica_operacional_id', politica.id)
    .eq('cedente_fundo_id', cedenteFundo.id)
    .not('publicada_em', 'is', null)
    .lte('vigente_desde', now)
    .or(`vigente_ate.is.null,vigente_ate.gt.${now}`)
    .order('versao', { ascending: false })
    .limit(1)

  if (versionError) throw new Error(`Erro ao buscar versao da politica: ${versionError.message}`)
  if (!versions || versions.length !== 1) {
    throw new CedenteFundoError(
      'Nao existe uma versao publicada e vigente para a politica operacional ativa.',
      'POLITICA_CONTEXT_NOT_CONFIGURED',
    )
  }

  const versao = versions[0] as PoliticaOperacionalVersao
  const { data: requirements, error: requirementError } = await supabase
    .from('politica_requisitos_documentais')
    .select('*')
    .eq('politica_operacional_versao_id', versao.id)
    .eq('cedente_fundo_id', cedenteFundo.id)
    .eq('ativo', true)
    .order('ordem', { ascending: true })
    .order('codigo', { ascending: true })

  if (requirementError) throw new Error(`Erro ao buscar requisitos documentais: ${requirementError.message}`)

  const resolvedPolicy = {
    cedenteFundo,
    fundo,
    politica,
    versao,
    requisitos: (requirements || []) as PoliticaRequisitoDocumental[],
  }
  validarContextoOperacional(resolvedPolicy)
  return resolvedPolicy
}

export async function resolverPoliticaAtiva(
  cedenteId: string,
  client?: AppSupabaseClient,
): Promise<PoliticaResolvida> {
  const context = await requireCedenteAccess(cedenteId, client)
  const resolved = await resolverCedenteFundoAtivo(cedenteId, context.supabase)

  if (resolved.source !== 'bridge' || !resolved.cedenteFundo || !resolved.fundo) {
    throw new CedenteFundoError(
      'O cedente precisa ter um vinculo cedente-fundo ativo para usar uma politica operacional.',
      'POLITICA_CONTEXT_NOT_CONFIGURED',
    )
  }

  return carregarPoliticaResolvida(context.supabase, resolved.cedenteFundo, resolved.fundo)
}

export async function resolverPoliticaAtivaPorVinculo(
  input: { cedenteId: string; cedenteFundoId: string; fundoId: string },
  client?: AppSupabaseClient,
): Promise<PoliticaResolvida> {
  const context = await requireCedenteAccess(input.cedenteId, client)
  const { data: link, error: linkError } = await context.supabase
    .from('cedente_fundos')
    .select('*')
    .eq('id', input.cedenteFundoId)
    .eq('cedente_id', input.cedenteId)
    .eq('fundo_id', input.fundoId)
    .maybeSingle()

  if (linkError) throw new CedenteFundoError(`Erro ao validar vinculo cedente-fundo: ${linkError.message}`, 'VINCULO_NOT_FOUND')
  if (!link) throw new CedenteFundoError('Vinculo cedente-fundo nao encontrado para a nota fiscal.', 'VINCULO_NOT_FOUND')

  const cedenteFundo = link as CedenteFundo
  if (cedenteFundo.status !== 'ativo') {
    throw new CedenteFundoError('O vinculo cedente-fundo da nota fiscal nao esta ativo.', 'VINCULO_NOT_FOUND')
  }

  const { data: fundoRow, error: fundoError } = await context.supabase
    .from('fundos')
    .select('*')
    .eq('id', input.fundoId)
    .maybeSingle()

  if (fundoError) throw new CedenteFundoError(`Erro ao validar fundo da nota fiscal: ${fundoError.message}`, 'FUNDO_NOT_FOUND')
  if (!fundoRow) throw new CedenteFundoError('Fundo da nota fiscal nao encontrado.', 'FUNDO_NOT_FOUND')

  const fundo = fundoRow as Fundo
  assertFundoAtivo(fundo)
  return carregarPoliticaResolvida(context.supabase, cedenteFundo, fundo)
}
