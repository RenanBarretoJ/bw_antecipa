import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAuthenticated } from '@/lib/auth/authorization'
import { buildPaginatedResult } from '@/lib/pagination'
import type { EstabelecimentoListaItem, EstabelecimentoPendenciaFiltro, FiltrosEstabelecimentos, ResultadoEstabelecimentos } from './estabelecimentos-listagem'

type Row = {
  estabelecimento_id: string
  cnpj: string
  razao_social: string
  nome_fantasia: string | null
  tipo: 'matriz' | 'filial'
  status: string
  ativo: boolean
  total_obrigatorios: number
  aprovados_obrigatorios: number
  aguardando_analise: number
  tem_conta_principal: boolean
  pendencia: EstabelecimentoPendenciaFiltro
  total_itens: number | string
}

export async function carregarEstabelecimentosPaginados(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  cedenteId: string,
  filtros: FiltrosEstabelecimentos,
): Promise<ResultadoEstabelecimentos> {
  const { data, error } = await supabase.rpc('listar_estabelecimentos_pagina', {
    p_cedente_id: cedenteId,
    p_tipo: filtros.tipo,
    p_status: filtros.status,
    p_pendencia: filtros.pendencia,
    p_q: filtros.q || null,
    p_page: filtros.page,
    p_page_size: filtros.pageSize,
  })
  if (error) throw new Error(`Nao foi possivel carregar os estabelecimentos: ${error.message}`)

  const rows = (data || []) as Row[]
  const total = rows.length > 0 ? Number(rows[0].total_itens) : 0
  const items: EstabelecimentoListaItem[] = rows.map((row) => ({
    id: row.estabelecimento_id,
    cnpj: row.cnpj,
    razaoSocial: row.razao_social,
    nomeFantasia: row.nome_fantasia,
    tipo: row.tipo,
    status: row.status,
    ativo: row.ativo,
    totalObrigatorios: row.total_obrigatorios,
    aprovadosObrigatorios: row.aprovados_obrigatorios,
    aguardandoAnalise: row.aguardando_analise,
    temContaPrincipal: row.tem_conta_principal,
    pendencia: row.pendencia,
  }))
  return buildPaginatedResult(items, { page: filtros.page, pageSize: filtros.pageSize, total })
}

export async function carregarMeusEstabelecimentosPaginados(filtros: FiltrosEstabelecimentos): Promise<ResultadoEstabelecimentos> {
  const context = await requireAuthenticated()
  if (context.profile.role !== 'cedente') throw new Error('Apenas o cedente pode executar esta acao.')
  const { data, error } = await context.supabase.from('cedentes').select('id').eq('user_id', context.user.id).maybeSingle()
  if (error) throw new Error(`Nao foi possivel consultar o cedente: ${error.message}`)
  if (!data) throw new Error('Cadastro de cedente nao encontrado.')
  return carregarEstabelecimentosPaginados(context.supabase, (data as { id: string }).id, filtros)
}
