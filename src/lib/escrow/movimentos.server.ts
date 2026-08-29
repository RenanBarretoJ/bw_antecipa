import 'server-only'

import { requireRole, type AuthContext, AuthorizationError } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import {
  buildDescendingCreatedAtCursorFilter,
} from '@/lib/pagination/keyset'
import {
  MOVIMENTOS_PAGE_SIZE,
  normalizarFiltrosMovimentos,
  paginarMovimentos,
  validarCursorMovimentos,
  type ContaEscrowDetalhe,
  type FiltrosMovimentos,
  type PerfilExtrato,
  type ResultadoMovimentos,
} from './movimentos'

type ContaRow = {
  id: string
  cedente_id: string
  identificador: string
  saldo_disponivel: number
  saldo_bloqueado: number
  status: string
  cedentes: { razao_social: string; cnpj: string } | null
}

async function autorizarConta(
  auth: AuthContext,
  perfil: PerfilExtrato,
  contaId?: string,
): Promise<ContaEscrowDetalhe | null> {
  let cedenteProprioId: string | null = null
  if (perfil === 'cedente') {
    // get_user_cedente_id() resolve a associacao organizacional ativa.
    const { data: cedenteIdResolvido, error: cedenteError } = await auth.supabase.rpc('get_user_cedente_id')
    if (cedenteError) throw new Error(`Nao foi possivel resolver o cedente autenticado: ${cedenteError.message}`)
    cedenteProprioId = cedenteIdResolvido || null
    if (!cedenteProprioId) throw new AuthorizationError('Cedente autenticado nao encontrado.', 'FORBIDDEN')
  }

  let query = auth.supabase
    .from('contas_escrow')
    .select('id, cedente_id, identificador, saldo_disponivel, saldo_bloqueado, status, cedentes(razao_social, cnpj)')
  if (contaId) query = query.eq('id', contaId)
  if (cedenteProprioId) query = query.eq('cedente_id', cedenteProprioId)
  const { data, error } = await query.limit(1).maybeSingle()
  if (error) throw new Error(`Nao foi possivel carregar a conta escrow: ${error.message}`)
  if (!data) return null
  const row = data as unknown as ContaRow
  if (!row.cedentes) return null

  if (perfil === 'gestor') {
    const contexto = await resolverContextoFundoGestor(auth)
    const { data: vinculo, error: vinculoError } = await auth.supabase
      .from('cedente_fundos')
      .select('id')
      .eq('cedente_id', row.cedente_id)
      .eq('fundo_id', contexto.fundoId)
      .in('status', ['ativo', 'suspenso'])
      .limit(1)
      .maybeSingle()
    if (vinculoError) throw new Error(`Nao foi possivel validar o fundo da conta: ${vinculoError.message}`)
    if (!vinculo) throw new AuthorizationError('Conta escrow fora do fundo ativo.', 'FORBIDDEN')
  } else if (perfil === 'consultor') {
    const { data: vinculo, error: vinculoError } = await auth.supabase
      .from('consultor_cedente')
      .select('id')
      .eq('consultor_id', auth.user.id)
      .eq('cedente_id', row.cedente_id)
      .limit(1)
      .maybeSingle()
    if (vinculoError) throw new Error(`Nao foi possivel validar a carteira: ${vinculoError.message}`)
    if (!vinculo) throw new AuthorizationError('Conta escrow fora da carteira do consultor.', 'FORBIDDEN')
  } else if (row.cedente_id !== cedenteProprioId) {
    throw new AuthorizationError('Conta escrow nao pertence ao cedente autenticado.', 'FORBIDDEN')
  }

  return {
    id: row.id,
    cedenteId: row.cedente_id,
    identificador: row.identificador,
    saldoDisponivel: Number(row.saldo_disponivel || 0),
    saldoBloqueado: Number(row.saldo_bloqueado || 0),
    status: row.status,
    cedente: { nome: row.cedentes.razao_social, cnpj: row.cedentes.cnpj },
  }
}

export async function carregarContaEscrowAutorizada(
  perfil: PerfilExtrato,
  contaId?: string,
): Promise<{ auth: AuthContext; conta: ContaEscrowDetalhe | null }> {
  const auth = await requireRole(perfil)
  return { auth, conta: await autorizarConta(auth, perfil, contaId) }
}

export async function carregarMovimentosEscrow(
  perfil: PerfilExtrato,
  contaId: string,
  filtrosInput: Partial<FiltrosMovimentos> = {},
  cursorInput?: string | null,
): Promise<ResultadoMovimentos> {
  const { auth, conta } = await carregarContaEscrowAutorizada(perfil, contaId)
  if (!conta) throw new AuthorizationError('Conta escrow nao encontrada.', 'NOT_FOUND')
  const filtros = normalizarFiltrosMovimentos(filtrosInput)
  const cursor = validarCursorMovimentos(cursorInput)
  let query = auth.supabase
    .from('movimentos_escrow')
    .select('id, tipo, descricao, valor, saldo_apos, created_at')
    .eq('conta_escrow_id', contaId)
  if (filtros.tipo) query = query.eq('tipo', filtros.tipo)
  if (filtros.dataInicio) query = query.gte('created_at', `${filtros.dataInicio}T00:00:00.000Z`)
  if (filtros.dataFim) query = query.lte('created_at', `${filtros.dataFim}T23:59:59.999Z`)
  if (cursor) query = query.or(buildDescendingCreatedAtCursorFilter(cursor))

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MOVIMENTOS_PAGE_SIZE + 1)
  if (error) throw new Error(`Nao foi possivel carregar os movimentos: ${error.message}`)
  return paginarMovimentos(data || [])
}
