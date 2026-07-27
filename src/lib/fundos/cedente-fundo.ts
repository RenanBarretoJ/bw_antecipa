import type { CedenteFundo, Fundo } from '@/types/database'
import { cookies } from 'next/headers'
import { requireCedenteAccess, requireGestor, type AppSupabaseClient } from '@/lib/auth/authorization'
import { requirePermissao } from '@/lib/auth/permissoes'
import { registrarLog } from '@/lib/actions/auditoria'
import { CEDENTE_FUNDO_ATIVO_COOKIE } from '@/lib/fundos/cedente-fundo-ativo'

export type CedenteFundoResolutionSource = 'cedente_fundos'
export type StatusOnboardingCedente = 'aguardando_vinculo_fundo' | 'aguardando_politica' | 'apto_operar' | 'suspenso'

export interface CedenteFundoResolution {
  cedenteId: string
  cedenteFundo: CedenteFundo | null
  fundo: Fundo | null
  source: CedenteFundoResolutionSource
  legacyFundoId: string | null
  contextoStatus: 'ok' | 'sem_vinculo_fundo'
}

export interface CedenteFundoListItem extends CedenteFundoResolution {
  status: CedenteFundo['status'] | 'sem_vinculo_fundo'
}

export class CedenteFundoError extends Error {
  readonly code:
    | 'CEDENTE_NOT_FOUND'
    | 'FUNDO_NOT_FOUND'
    | 'FUNDO_INATIVO'
    | 'VINCULO_NOT_FOUND'
    | 'VINCULO_DUPLICADO'
    | 'MULTIPLOS_VINCULOS_ATIVOS'
    | 'SEM_VINCULO_FUNDO'
    | 'POLITICA_CONTEXT_NOT_CONFIGURED'

  constructor(message: string, code: CedenteFundoError['code']) {
    super(message)
    this.name = 'CedenteFundoError'
    this.code = code
  }
}

export function mensagemOperacionalSemVinculo(): string {
  return 'O cedente ainda nao foi vinculado a um fundo.'
}

export function mensagemOperacionalSemPolitica(): string {
  return 'O vinculo com o fundo ainda nao possui politica operacional definida.'
}

async function loadFundo(client: AppSupabaseClient, fundoId: string): Promise<Fundo> {
  const { data, error } = await client
    .from('fundos')
    .select('*')
    .eq('id', fundoId)
    .maybeSingle()

  if (error) throw new CedenteFundoError(`Erro ao consultar fundo vinculado: ${error.message}`, 'FUNDO_NOT_FOUND')
  if (!data) throw new CedenteFundoError('Fundo vinculado nao encontrado ou sem permissao de leitura.', 'FUNDO_NOT_FOUND')
  return data as Fundo
}

export function assertFundoAtivo(fundo: Fundo): void {
  if (fundo.ativo !== true) {
    throw new CedenteFundoError('O fundo selecionado esta inativo.', 'FUNDO_INATIVO')
  }
}

export function selecionarVinculoAtivo(links: CedenteFundo[]): CedenteFundo | null {
  if (links.length > 1) {
    throw new CedenteFundoError(
      'Mais de um vinculo ativo para este cedente; selecione explicitamente o fundo operacional.',
      'MULTIPLOS_VINCULOS_ATIVOS',
    )
  }
  return links[0] || null
}

async function obterCedenteFundoAtivoSelecionado(): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    return cookieStore.get(CEDENTE_FUNDO_ATIVO_COOKIE)?.value || null
  } catch {
    return null
  }
}

async function possuiPoliticaPublicadaVigente(client: AppSupabaseClient, cedenteFundoId: string): Promise<boolean> {
  const now = new Date().toISOString()
  const { data: assignments, error: assignmentError } = await client
    .from('cedente_fundo_politicas')
    .select('politica_operacional_id')
    .eq('cedente_fundo_id', cedenteFundoId)
    .eq('status', 'ativa')
    .lte('vigente_desde', now)
    .or(`vigente_ate.is.null,vigente_ate.gt.${now}`)
    .order('vigente_desde', { ascending: false })
    .limit(1)

  if (assignmentError) {
    throw new CedenteFundoError(`Erro ao consultar politica do vinculo: ${assignmentError.message}`, 'POLITICA_CONTEXT_NOT_CONFIGURED')
  }

  const politicaId = (assignments?.[0] as { politica_operacional_id?: string } | undefined)?.politica_operacional_id
  if (!politicaId) return false

  const { data: versions, error: versionError } = await client
    .from('politica_operacional_versoes')
    .select('id')
    .eq('politica_operacional_id', politicaId)
    .eq('status', 'publicada')
    .not('publicada_em', 'is', null)
    .lte('vigente_desde', now)
    .or(`vigente_ate.is.null,vigente_ate.gt.${now}`)
    .limit(1)

  if (versionError) {
    throw new CedenteFundoError(`Erro ao consultar versao publicada da politica: ${versionError.message}`, 'POLITICA_CONTEXT_NOT_CONFIGURED')
  }
  return Boolean(versions?.length)
}

export async function obterStatusCedenteFundo(
  cedenteFundoId: string,
  client?: AppSupabaseClient,
): Promise<StatusOnboardingCedente> {
  const context = await requireGestor(client)
  const { data: link, error } = await context.supabase
    .from('cedente_fundos')
    .select('*')
    .eq('id', cedenteFundoId)
    .maybeSingle()

  if (error) throw new CedenteFundoError(`Erro ao consultar vinculo cedente-fundo: ${error.message}`, 'VINCULO_NOT_FOUND')
  if (!link) throw new CedenteFundoError('Vinculo cedente-fundo nao encontrado.', 'VINCULO_NOT_FOUND')

  const vinculo = link as CedenteFundo
  if (vinculo.status === 'suspenso') return 'suspenso'
  if (vinculo.status !== 'ativo') return 'aguardando_vinculo_fundo'

  return await possuiPoliticaPublicadaVigente(context.supabase, cedenteFundoId) ? 'apto_operar' : 'aguardando_politica'
}

export async function obterStatusOnboardingCedente(
  cedenteId: string,
  client?: AppSupabaseClient,
): Promise<StatusOnboardingCedente> {
  const context = await requireGestor(client)
  const { data: links, error } = await context.supabase
    .from('cedente_fundos')
    .select('*')
    .eq('cedente_id', cedenteId)
    .order('vigente_desde', { ascending: false })

  if (error) throw new CedenteFundoError(`Erro ao consultar vinculos do cedente: ${error.message}`, 'VINCULO_NOT_FOUND')

  const rows = (links || []) as CedenteFundo[]
  const activeLinks = rows.filter((link) => link.status === 'ativo')
  if (activeLinks.length === 0) return rows.some((link) => link.status === 'suspenso') ? 'suspenso' : 'aguardando_vinculo_fundo'

  for (const link of activeLinks) {
    if (await possuiPoliticaPublicadaVigente(context.supabase, link.id)) return 'apto_operar'
  }

  return 'aguardando_politica'
}

/** Resolve exclusivamente por cedente_fundos. cedentes.fundo_id nao participa do fluxo operacional. */
export async function resolverCedenteFundoAtivo(
  cedenteId: string,
  client?: AppSupabaseClient,
): Promise<CedenteFundoResolution> {
  const context = await requireCedenteAccess(cedenteId, client)
  const supabase = context.supabase

  const { data: links, error } = await supabase
    .from('cedente_fundos')
    .select('*')
    .eq('cedente_id', cedenteId)
    .eq('status', 'ativo')
    .order('vigente_desde', { ascending: false })

  if (error) throw new CedenteFundoError(`Erro ao resolver vinculo cedente-fundo: ${error.message}`, 'VINCULO_NOT_FOUND')

  const activeLinks = (links || []) as CedenteFundo[]
  if (activeLinks.length > 1) {
    const selectedCedenteFundoId = await obterCedenteFundoAtivoSelecionado()
    const selectedLink = activeLinks.find((item) => item.id === selectedCedenteFundoId)
    if (!selectedLink) {
      throw new CedenteFundoError(
        'Ha mais de um vinculo ativo para este cedente; selecione explicitamente o fundo operacional.',
        'MULTIPLOS_VINCULOS_ATIVOS',
      )
    }
    const fundo = await loadFundo(supabase, selectedLink.fundo_id)
    assertFundoAtivo(fundo)
    return {
      cedenteId,
      cedenteFundo: selectedLink,
      fundo,
      source: 'cedente_fundos',
      legacyFundoId: null,
      contextoStatus: 'ok',
    }
  }

  const link = selecionarVinculoAtivo(activeLinks)
  if (!link) {
    return {
      cedenteId,
      cedenteFundo: null,
      fundo: null,
      source: 'cedente_fundos',
      legacyFundoId: null,
      contextoStatus: 'sem_vinculo_fundo',
    }
  }

  const fundo = await loadFundo(supabase, link.fundo_id)
  assertFundoAtivo(fundo)
  return {
    cedenteId,
    cedenteFundo: link,
    fundo,
    source: 'cedente_fundos',
    legacyFundoId: null,
    contextoStatus: 'ok',
  }
}

export async function listarFundosDoCedente(
  cedenteId: string,
  client?: AppSupabaseClient,
): Promise<CedenteFundoListItem[]> {
  const context = await requireCedenteAccess(cedenteId, client)
  const supabase = context.supabase
  const { data: links, error } = await supabase
    .from('cedente_fundos')
    .select('*')
    .eq('cedente_id', cedenteId)
    .order('vigente_desde', { ascending: false })

  if (error) throw new CedenteFundoError(`Erro ao listar vinculos: ${error.message}`, 'VINCULO_NOT_FOUND')

  const rows = (links || []) as CedenteFundo[]
  const fundos = new Map<string, Fundo>()
  for (const link of rows) fundos.set(link.fundo_id, await loadFundo(supabase, link.fundo_id))

  return rows.map((link) => ({
    cedenteId,
    cedenteFundo: link,
    fundo: fundos.get(link.fundo_id) || null,
    source: 'cedente_fundos',
    legacyFundoId: null,
    contextoStatus: 'ok',
    status: link.status,
  }))
}

export async function vincularCedenteFundo(
  cedenteId: string,
  fundoId: string,
  client?: AppSupabaseClient,
  options?: { motivo?: string },
): Promise<CedenteFundo> {
  const context = await requireGestor(client)
  const supabase = context.supabase
  await requireCedenteAccess(cedenteId, supabase)
  await requirePermissao(context, 'cedentes.vincular_fundo', { fundoId, client: supabase })
  const fundo = await loadFundo(supabase, fundoId)
  assertFundoAtivo(fundo)

  const { data: existing } = await supabase
    .from('cedente_fundos')
    .select('*')
    .eq('cedente_id', cedenteId)
    .eq('fundo_id', fundoId)
    .eq('status', 'ativo')
    .maybeSingle()

  if (existing) return existing as CedenteFundo

  const now = new Date().toISOString()
  const { data: link, error } = await supabase
    .from('cedente_fundos')
    .insert({
      cedente_id: cedenteId,
      fundo_id: fundoId,
      status: 'ativo',
      vigente_desde: now,
      observacoes: options?.motivo?.trim() || null,
    })
    .select('*')
    .single()

  if (error || !link) {
    if (error?.code === '23505') throw new CedenteFundoError('Este vinculo ativo ja existe.', 'VINCULO_DUPLICADO')
    throw new CedenteFundoError(`Erro ao criar vinculo: ${error?.message || 'registro nao retornado'}`, 'VINCULO_NOT_FOUND')
  }

  await registrarLog({
    tipo_evento: 'CEDENTE_FUNDO_VINCULADO',
    entidade_tipo: 'cedente_fundos',
    entidade_id: link.id,
    dados_depois: {
      cedente_id: cedenteId,
      fundo_id: fundoId,
      source: 'cedente_fundos',
      motivo: options?.motivo?.trim() || null,
    },
  })

  return link as CedenteFundo
}

export async function suspenderCedenteFundo(
  cedenteId: string,
  fundoId?: string,
  client?: AppSupabaseClient,
): Promise<void> {
  const context = await requireGestor(client)
  const supabase = context.supabase
  let targetFundoId = fundoId
  if (!targetFundoId) {
    const { data: activeLinks, error: activeLinksError } = await supabase
      .from('cedente_fundos')
      .select('id, fundo_id')
      .eq('cedente_id', cedenteId)
      .eq('status', 'ativo')
    if (activeLinksError) throw new CedenteFundoError(`Erro ao buscar vinculos ativos: ${activeLinksError.message}`, 'VINCULO_NOT_FOUND')
    if (!activeLinks || activeLinks.length === 0) throw new CedenteFundoError('Vinculo ativo nao encontrado.', 'VINCULO_NOT_FOUND')
    if (activeLinks.length > 1) throw new CedenteFundoError('Informe o fundo para suspender um vinculo quando houver mais de um ativo.', 'MULTIPLOS_VINCULOS_ATIVOS')
    targetFundoId = (activeLinks[0] as { fundo_id: string }).fundo_id
  }
  await requirePermissao(context, 'cedentes.vincular_fundo', { fundoId: targetFundoId, client: supabase })

  const { data, error } = await supabase
    .from('cedente_fundos')
    .update({ status: 'suspenso', vigente_ate: new Date().toISOString() })
    .eq('cedente_id', cedenteId)
    .eq('status', 'ativo')
    .eq('fundo_id', targetFundoId)
    .select('id, fundo_id')

  if (error) throw new CedenteFundoError(`Erro ao suspender vinculo: ${error.message}`, 'VINCULO_NOT_FOUND')
  if (!data || data.length === 0) throw new CedenteFundoError('Vinculo ativo nao encontrado.', 'VINCULO_NOT_FOUND')

  await registrarLog({
    tipo_evento: 'CEDENTE_FUNDO_SUSPENSO',
    entidade_tipo: 'cedente_fundos',
    entidade_id: data[0].id,
    dados_depois: { cedente_id: cedenteId, fundo_id: data[0].fundo_id },
  })
}
