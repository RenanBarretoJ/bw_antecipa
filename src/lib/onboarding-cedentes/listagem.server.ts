import 'server-only'

import { requireGestor } from '@/lib/auth/authorization'
import { buildPaginationMeta } from '@/lib/pagination'
import type { CedenteStatus } from '@/lib/types/domain'
import { resolverFundoAtivoOnboarding } from './contexto.server'
import type {
  ContagensOnboarding,
  FiltrosOnboarding,
  ResultadoOnboarding,
} from './listagem'
import { normalizarPayloadOnboarding } from './listagem'

const CONTAGENS_VAZIAS: ContagensOnboarding = {
  pendencias: 0,
  sem_fundo: 0,
  sem_politica: 0,
  aptos: 0,
  suspensos: 0,
  todos: 0,
}

export async function carregarOnboardingCedentesPaginado(
  filtros: FiltrosOnboarding,
): Promise<ResultadoOnboarding> {
  const context = await requireGestor()
  const fundoAtivo = await resolverFundoAtivoOnboarding(context)
  if (!fundoAtivo) {
    return {
      items: [],
      pagination: buildPaginationMeta({
        page: filtros.pagina,
        pageSize: filtros.limite,
        total: 0,
        currentItemCount: 0,
      }),
      counts: CONTAGENS_VAZIAS,
      fundoAtivo: null,
      politicasFiltro: [],
    }
  }

  const [listagem, politicas] = await Promise.all([
    context.supabase.rpc('listar_onboarding_cedentes_paginado', {
      p_fundo_id: fundoAtivo.id,
      p_page: filtros.pagina,
      p_page_size: filtros.limite,
      p_busca: filtros.busca || null,
      p_etapa: filtros.etapa,
      p_status_cadastral: filtros.statusCadastral as CedenteStatus | null,
      p_politica_id: filtros.politicaId,
      p_sort: filtros.ordenacao,
      p_direction: filtros.direcao,
    }),
    context.supabase
      .from('politicas_operacionais')
      .select('id, nome')
      .eq('fundo_id', fundoAtivo.id)
      .eq('status', 'ativa')
      .order('nome', { ascending: true }),
  ])

  if (listagem.error) throw new Error(`Nao foi possivel carregar o onboarding: ${listagem.error.message}`)
  if (politicas.error) throw new Error(`Nao foi possivel carregar o filtro de politicas: ${politicas.error.message}`)

  const payload = normalizarPayloadOnboarding(listagem.data)
  const pagination = buildPaginationMeta({
    page: filtros.pagina,
    pageSize: filtros.limite,
    total: payload.total,
    currentItemCount: payload.items.length,
  })

  return {
    items: payload.items,
    pagination,
    counts: payload.counts,
    fundoAtivo,
    politicasFiltro: (politicas.data || []).map((politica) => ({
      id: politica.id,
      nome: politica.nome,
    })),
  }
}
