import type { CedenteFundo, Fundo } from '@/types/database'
import { requireCedenteAccess, requireGestor, type AppSupabaseClient } from '@/lib/auth/authorization'
import { registrarLog } from '@/lib/actions/auditoria'

export type CedenteFundoResolutionSource = 'bridge' | 'legacy'

export interface CedenteFundoResolution {
  cedenteId: string
  cedenteFundo: CedenteFundo | null
  fundo: Fundo | null
  source: CedenteFundoResolutionSource
  legacyFundoId: string | null
}

export interface CedenteFundoListItem extends CedenteFundoResolution {
  status: CedenteFundo['status'] | 'legado'
}

export class CedenteFundoError extends Error {
  readonly code:
    | 'CEDENTE_NOT_FOUND'
    | 'FUNDO_NOT_FOUND'
    | 'FUNDO_INATIVO'
    | 'VINCULO_NOT_FOUND'
    | 'VINCULO_DUPLICADO'
    | 'MULTIPLOS_VINCULOS_ATIVOS'
    | 'POLITICA_CONTEXT_NOT_CONFIGURED'

  constructor(message: string, code: CedenteFundoError['code']) {
    super(message)
    this.name = 'CedenteFundoError'
    this.code = code
  }
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
    throw new CedenteFundoError('O fundo selecionado está inativo.', 'FUNDO_INATIVO')
  }
}

export function selecionarVinculoAtivo(links: CedenteFundo[]): CedenteFundo | null {
  if (links.length > 1) {
    throw new CedenteFundoError(
      'Mais de um vinculo ativo para este cedente; a politica precisa indicar o contexto do fundo.',
      'MULTIPLOS_VINCULOS_ATIVOS',
    )
  }
  return links[0] || null
}

/** Resolve primeiro o bridge e só usa fundo_id como compatibilidade legada. */
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

  if (error) throw new CedenteFundoError(`Erro ao resolver vínculo cedente-fundo: ${error.message}`, 'VINCULO_NOT_FOUND')

  const activeLinks = (links || []) as CedenteFundo[]
  if (activeLinks.length > 1) {
    throw new CedenteFundoError(
      'Há mais de um vínculo ativo para este cedente; a política precisa indicar o contexto do fundo.',
      'MULTIPLOS_VINCULOS_ATIVOS',
    )
  }

  if (activeLinks.length === 1) {
    const link = activeLinks[0]
    const fundo = await loadFundo(supabase, link.fundo_id)
    assertFundoAtivo(fundo)
    return {
      cedenteId,
      cedenteFundo: link,
      fundo,
      source: 'bridge',
      legacyFundoId: context.cedente.fundo_id,
    }
  }

  if (!context.cedente.fundo_id) {
    return { cedenteId, cedenteFundo: null, fundo: null, source: 'legacy', legacyFundoId: null }
  }

  const fundo = await loadFundo(supabase, context.cedente.fundo_id)
  assertFundoAtivo(fundo)
  return {
    cedenteId,
    cedenteFundo: null,
    fundo,
    source: 'legacy',
    legacyFundoId: context.cedente.fundo_id,
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

  if (error) throw new CedenteFundoError(`Erro ao listar vínculos: ${error.message}`, 'VINCULO_NOT_FOUND')

  const rows = (links || []) as CedenteFundo[]
  const fundos = new Map<string, Fundo>()
  for (const link of rows) fundos.set(link.fundo_id, await loadFundo(supabase, link.fundo_id))

  const result: CedenteFundoListItem[] = rows.map((link) => ({
    cedenteId,
    cedenteFundo: link,
    fundo: fundos.get(link.fundo_id) || null,
    source: 'bridge',
    legacyFundoId: context.cedente.fundo_id,
    status: link.status,
  }))

  if (result.length === 0 && context.cedente.fundo_id) {
    const fundo = await loadFundo(supabase, context.cedente.fundo_id)
    result.push({
      cedenteId,
      cedenteFundo: null,
      fundo,
      source: 'legacy',
      legacyFundoId: context.cedente.fundo_id,
      status: 'legado',
    })
  }

  return result
}

export async function vincularCedenteFundo(
  cedenteId: string,
  fundoId: string,
  client?: AppSupabaseClient,
): Promise<CedenteFundo> {
  const context = await requireGestor(client)
  const supabase = context.supabase
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
    })
    .select('*')
    .single()

  if (error || !link) {
    if (error?.code === '23505') throw new CedenteFundoError('Este vínculo ativo já existe.', 'VINCULO_DUPLICADO')
    throw new CedenteFundoError(`Erro ao criar vínculo: ${error?.message || 'registro não retornado'}`, 'VINCULO_NOT_FOUND')
  }

  const { error: legacyError } = await supabase
    .from('cedentes')
    .update({ fundo_id: fundoId })
    .eq('id', cedenteId)

  if (legacyError) {
    await supabase.from('cedente_fundos').delete().eq('id', link.id)
    throw new CedenteFundoError(`Vínculo criado, mas não foi possível sincronizar o campo legado: ${legacyError.message}`, 'VINCULO_NOT_FOUND')
  }

  await registrarLog({
    tipo_evento: 'CEDENTE_FUNDO_VINCULADO',
    entidade_tipo: 'cedente_fundos',
    entidade_id: link.id,
    dados_depois: { cedente_id: cedenteId, fundo_id: fundoId, source: 'bridge' },
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

  const { data, error } = await supabase
    .from('cedente_fundos')
    .update({ status: 'suspenso', vigente_ate: new Date().toISOString() })
    .eq('cedente_id', cedenteId)
    .eq('status', 'ativo')
    .eq('fundo_id', targetFundoId)
    .select('id, fundo_id')

  if (error) throw new CedenteFundoError(`Erro ao suspender vínculo: ${error.message}`, 'VINCULO_NOT_FOUND')
  if (!data || data.length === 0) throw new CedenteFundoError('Vínculo ativo não encontrado.', 'VINCULO_NOT_FOUND')

  const { error: legacyError } = await supabase
    .from('cedentes')
    .update({ fundo_id: null })
    .eq('id', cedenteId)
    .eq('fundo_id', targetFundoId)

  if (legacyError) throw new CedenteFundoError(`Vínculo suspenso, mas não foi possível sincronizar o campo legado: ${legacyError.message}`, 'VINCULO_NOT_FOUND')

  await registrarLog({
    tipo_evento: 'CEDENTE_FUNDO_SUSPENSO',
    entidade_tipo: 'cedente_fundos',
    entidade_id: data[0].id,
    dados_depois: { cedente_id: cedenteId, fundo_id: data[0].fundo_id },
  })
}
