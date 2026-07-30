import 'server-only'

import { requireGestor } from '@/lib/auth/authorization'
import { encodeCursor, parseCursor } from '@/lib/pagination/cursor'
import { buildDescendingCreatedAtCursorFilter } from '@/lib/pagination/keyset'
import { normalizarBusca } from '@/lib/pagination/search'
import type {
  AuditoriaDetalhe,
  AuditoriaFiltros,
  AuditoriaListagemItem,
  AuditoriaPagina,
} from './contracts'
import { mascararIp, sanitizarDetalheAuditoria } from './privacy'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SAFE_FILTER_PATTERN = /^[\p{L}\p{N}_ .:@/-]{1,120}$/u

function filtroSeguro(value: unknown): string {
  const normalized = normalizarBusca(value)
  return SAFE_FILTER_PATTERN.test(normalized) ? normalized : ''
}

function buscaSegura(value: unknown): string {
  return normalizarBusca(value)
    .replace(/[^\p{L}\p{N} .:@/-]/gu, '')
    .trim()
}

function dataSegura(value: unknown): string {
  return typeof value === 'string' && DATE_PATTERN.test(value) ? value : ''
}

function inicioDiaSeguinte(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

function termoOrSeguro(value: string): string {
  return value.replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim()
}

function perfilDaLinha(value: unknown) {
  if (Array.isArray(value)) return value[0] as Record<string, unknown> | undefined
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function mapItem(row: Record<string, unknown>): AuditoriaListagemItem {
  const profile = perfilDaLinha(row.profiles)
  const entidadeTipo = typeof row.entidade_tipo === 'string' ? row.entidade_tipo : null
  const entidadeId = typeof row.entidade_id === 'string' ? row.entidade_id : null
  const tipo = String(row.tipo_evento ?? '')
  const atorNome = String(profile?.nome_completo ?? row.ator_identificador ?? 'Sistema')

  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    tipo,
    acao: tipo,
    entidadeTipo,
    entidadeId,
    ator: {
      id: typeof row.usuario_id === 'string' ? row.usuario_id : null,
      nome: atorNome,
      perfil: String(profile?.role ?? row.ator_tipo ?? 'sistema'),
    },
    resumo: `${atorNome} executou ${tipo}${entidadeTipo ? ` em ${entidadeTipo}` : ''}.`,
    origem: typeof row.origem === 'string' ? row.origem : null,
    ipMascarado: mascararIp(row.ip_origem),
    possuiDetalhes: true,
  }
}

export function normalizarFiltrosAuditoria(input: AuditoriaFiltros): Required<AuditoriaFiltros> {
  return {
    q: buscaSegura(input.q),
    tipo: filtroSeguro(input.tipo),
    entidadeTipo: filtroSeguro(input.entidadeTipo),
    ator: filtroSeguro(input.ator),
    dataInicial: dataSegura(input.dataInicial),
    dataFinal: dataSegura(input.dataFinal),
  }
}

export async function carregarAuditoria(input: AuditoriaFiltros & {
  cursor?: string | null
  limit?: number
}): Promise<AuditoriaPagina> {
  const context = await requireGestor()
  const filtros = normalizarFiltrosAuditoria(input)
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 40)
  const cursor = input.cursor ? parseCursor(input.cursor) : null
  if (input.cursor && !cursor) throw new Error('Cursor de auditoria invalido.')

  const atorUuid = /^[0-9a-f-]{36}$/i.test(filtros.ator) ? filtros.ator : ''
  const profileRelation = filtros.ator && !atorUuid
    ? 'profiles!inner(nome_completo, role, email)'
    : 'profiles(nome_completo, role)'

  let query = context.supabase
    .from('logs_auditoria')
    .select(`
      id, usuario_id, ator_tipo, ator_identificador, origem, tipo_evento,
      entidade_tipo, entidade_id, ip_origem, created_at,
      ${profileRelation}
    `)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (filtros.tipo) query = query.eq('tipo_evento', filtros.tipo)
  if (filtros.entidadeTipo) query = query.eq('entidade_tipo', filtros.entidadeTipo)
  if (filtros.dataInicial) query = query.gte('created_at', `${filtros.dataInicial}T00:00:00.000000Z`)
  if (filtros.dataFinal) query = query.lt('created_at', inicioDiaSeguinte(filtros.dataFinal))
  if (filtros.ator) {
    if (atorUuid) query = query.eq('usuario_id', atorUuid)
    else {
      const actorTerm = termoOrSeguro(filtros.ator)
      query = query.or(
        `nome_completo.ilike.%${actorTerm}%,email.ilike.%${actorTerm}%`,
        { referencedTable: 'profiles' },
      )
    }
  }
  if (filtros.q) {
    const term = termoOrSeguro(filtros.q)
    query = query.or([
      `tipo_evento.ilike.%${term}%`,
      `entidade_tipo.ilike.%${term}%`,
      `ator_identificador.ilike.%${term}%`,
    ].join(','))
  }
  if (cursor) query = query.or(buildDescendingCreatedAtCursorFilter(cursor))

  const { data, error } = await query
  if (error) throw new Error(`Nao foi possivel carregar a auditoria: ${error.message}`)

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  const pageRows = rows.slice(0, limit)
  const last = pageRows.at(-1)
  const hasMore = rows.length > limit

  return {
    items: pageRows.map(mapItem),
    hasMore,
    nextCursor: hasMore && last
      ? encodeCursor({ createdAt: String(last.created_at), id: String(last.id) })
      : null,
  }
}

export async function carregarDetalheAuditoria(eventoId: string): Promise<AuditoriaDetalhe> {
  const context = await requireGestor()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventoId)) {
    throw new Error('Evento de auditoria invalido.')
  }

  const { data, error } = await context.supabase
    .from('logs_auditoria')
    .select('id, dados_antes, dados_depois')
    .eq('id', eventoId)
    .maybeSingle()

  if (error || !data) throw new Error('Evento de auditoria nao encontrado.')
  const row = data as Record<string, unknown>
  return {
    id: String(row.id),
    dadosAntes: sanitizarDetalheAuditoria(row.dados_antes) as Record<string, unknown> | null,
    dadosDepois: sanitizarDetalheAuditoria(row.dados_depois) as Record<string, unknown> | null,
  }
}
