import 'server-only'

import { requireRole } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { buildOffsetRange, buildPaginatedResult, buildPaginationMeta } from '@/lib/pagination'
import {
  calcularMetricasPaginaEscrow,
  type ContaEscrowListagemItem,
  type FiltrosEscrow,
  type ResultadoEscrow,
} from './listagem'

type Perfil = 'gestor' | 'consultor'
type Auth = Awaited<ReturnType<typeof requireRole>>

async function resolverEscopo(auth: Auth, perfil: Perfil) {
  if (perfil === 'gestor') {
    const contexto = await resolverContextoFundoGestor(auth)
    return { perfil, fundoId: contexto.fundoId, consultorId: null }
  }
  return { perfil, fundoId: null, consultorId: null }
}

async function buscarCedentesDoEscopo(
  auth: Auth,
  escopo: Awaited<ReturnType<typeof resolverEscopo>>,
  q: string,
) {
  const seguro = q.replace(/[,%().'"\u005c]/g, ' ')
  const digitos = q.replace(/\D/g, '')
  const condicoes = [`razao_social.ilike.%${seguro}%`]
  if (digitos) condicoes.push(`cnpj.ilike.%${digitos}%`)
  let query
  if (escopo.perfil === 'gestor') {
    query = auth.supabase
      .from('cedente_fundos')
      .select('cedente_id, cedentes!inner(id)')
      .eq('fundo_id', escopo.fundoId!)
      .in('status', ['ativo', 'suspenso'])
      .or(condicoes.join(','), { referencedTable: 'cedentes' })
  } else {
    const { data: carteira, error: carteiraError } = await auth.supabase.rpc('consultor_listar_cedente_ids_operacionais')
    if (carteiraError) throw new Error(`Nao foi possivel resolver a carteira da Consultoria: ${carteiraError.message}`)
    const ids = (carteira || []).map((item) => item.cedente_id)
    if (!ids.length) return []
    query = auth.supabase
      .from('cedentes')
      .select('id')
      .in('id', ids)
      .or(condicoes.join(','))
  }
  const { data, error } = await query.limit(200)
  if (error) throw new Error(`Nao foi possivel aplicar a busca de cedentes: ${error.message}`)
  return Array.from(new Set((data || []).map((row) => 'cedente_id' in row ? row.cedente_id : row.id)))
}

type Row = {
  id: string
  cedente_id: string
  identificador: string
  saldo_disponivel: number
  saldo_bloqueado: number
  status: string
  created_at: string
  cedentes: { razao_social: string; cnpj: string } | null
}

export async function carregarEscrowPaginado(
  perfil: Perfil,
  filtros: FiltrosEscrow,
): Promise<ResultadoEscrow> {
  const auth = await requireRole(perfil)
  const escopo = await resolverEscopo(auth, perfil)
  let cedentesEncontrados: string[] = []
  if (filtros.q) {
    cedentesEncontrados = await buscarCedentesDoEscopo(auth, escopo, filtros.q)
    const seguro = filtros.q.replace(/[,%().'"\u005c]/g, ' ')
    const { data: porIdentificador, error: identificadorError } = await auth.supabase
      .from('contas_escrow')
      .select('cedente_id')
      .ilike('identificador', `%${seguro}%`)
      .limit(200)
    if (identificadorError) throw new Error(`Nao foi possivel buscar contas escrow: ${identificadorError.message}`)
    cedentesEncontrados = Array.from(new Set([
      ...cedentesEncontrados,
      ...(porIdentificador || []).map((row) => row.cedente_id),
    ]))
    if (!cedentesEncontrados.length) {
      return {
        ...buildPaginatedResult([], { page: filtros.page, pageSize: filtros.pageSize, total: 0 }),
        metricasPagina: calcularMetricasPaginaEscrow([]),
      }
    }
  }

  const executar = async (page: number) => {
    const range = buildOffsetRange({ page, pageSize: filtros.pageSize })
    const select = escopo.perfil === 'gestor'
      ? 'id, cedente_id, identificador, saldo_disponivel, saldo_bloqueado, status, created_at, cedentes!inner(razao_social, cnpj, cedente_fundos!inner(fundo_id, status))'
      : 'id, cedente_id, identificador, saldo_disponivel, saldo_bloqueado, status, created_at, cedentes!inner(razao_social, cnpj)'
    let query = auth.supabase
      .from('contas_escrow')
      .select(select, { count: 'exact' })
    query = escopo.perfil === 'gestor'
      ? query
        .eq('cedentes.cedente_fundos.fundo_id', escopo.fundoId!)
        .in('cedentes.cedente_fundos.status', ['ativo', 'suspenso'])
      : query
    if (filtros.cedenteId) query = query.eq('cedente_id', filtros.cedenteId)
    if (filtros.q) query = query.in('cedente_id', cedentesEncontrados)
    if (filtros.status) query = query.eq('status', filtros.status)
    return query
      .order(filtros.sort, { ascending: filtros.direction === 'asc' })
      .order('id', { ascending: filtros.direction === 'asc' })
      .range(range.from, range.to)
  }

  let result = await executar(filtros.page)
  if (result.error) throw new Error(`Nao foi possivel carregar as contas escrow: ${result.error.message}`)
  const total = result.count || 0
  const meta = buildPaginationMeta({
    page: filtros.page,
    pageSize: filtros.pageSize,
    total,
    currentItemCount: result.data?.length || 0,
  })
  if (meta.wasPageAdjusted && total > 0) {
    result = await executar(meta.page)
    if (result.error) throw new Error(`Nao foi possivel ajustar a pagina das contas escrow: ${result.error.message}`)
  }
  const items = ((result.data || []) as unknown as Row[]).flatMap((row): ContaEscrowListagemItem[] => row.cedentes ? [{
    id: row.id,
    cedenteId: row.cedente_id,
    identificador: row.identificador,
    saldoDisponivel: Number(row.saldo_disponivel || 0),
    saldoBloqueado: Number(row.saldo_bloqueado || 0),
    status: row.status,
    criadoEm: row.created_at,
    cedente: { nome: row.cedentes.razao_social, cnpj: row.cedentes.cnpj },
  }] : [])
  return {
    ...buildPaginatedResult(items, { page: meta.page, pageSize: filtros.pageSize, total }),
    metricasPagina: calcularMetricasPaginaEscrow(items),
  }
}
