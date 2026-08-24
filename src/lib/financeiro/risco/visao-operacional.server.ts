import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'
import type { PoliticaOperacionalVersao } from '@/types/database'
import {
  montarVisaoExposicaoFundo,
  montarVisaoExposicaoOperacao,
  resolverControleExposicaoDoSnapshot,
  type ExposureExecutionLike,
  type RiskExecutionLike,
  type VisaoExposicaoOperacional,
} from './visao-operacional'

type Row = Record<string, unknown> & { id: string }

export async function carregarVisaoExposicaoOperacaoCanonica(input: {
  operacaoId: string
  fundoId: string
  politicaSnapshot: unknown
  riscoExecucaoId?: string | null
}): Promise<VisaoExposicaoOperacional | null> {
  const controle = resolverControleExposicaoDoSnapshot(input.politicaSnapshot)
  if (!controle.ativo) return null

  const admin = createAdminClient()
  let query = admin.from('risco_execucoes').select('*')
    .eq('operacao_id', input.operacaoId)
    .eq('fundo_id', input.fundoId)
    .eq('escopo', 'OPERACAO')

  query = input.riscoExecucaoId
    ? query.eq('id', input.riscoExecucaoId)
    : query.order('created_at', { ascending: false }).limit(1)

  const { data: execucoes, error } = await query
  if (error) throw new Error(`Não foi possível carregar a avaliação canônica da operação: ${error.message}`)
  const execucao = ((execucoes || []) as Row[])[0] || null

  const [motivosResult, exposicaoResult] = execucao
    ? await Promise.all([
        admin.from('risco_motivos').select('codigo').eq('risco_execucao_id', execucao.id).order('created_at'),
        execucao.exposicao_execucao_id
          ? admin.from('exposicao_execucoes').select('data_referencia_pl').eq('id', String(execucao.exposicao_execucao_id)).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])
    : [{ data: [], error: null }, { data: null, error: null }]

  if (motivosResult.error) throw new Error(`Não foi possível carregar os motivos da avaliação: ${motivosResult.error.message}`)
  if (exposicaoResult.error) throw new Error(`Não foi possível carregar a data-base da exposição: ${exposicaoResult.error.message}`)

  return montarVisaoExposicaoOperacao({
    controle,
    execucao: execucao as unknown as RiskExecutionLike | null,
    motivos: ((motivosResult.data || []) as Array<{ codigo: string }>).map((item) => item.codigo),
    dataBasePl: (exposicaoResult.data as { data_referencia_pl?: string } | null)?.data_referencia_pl || null,
  })
}

export async function carregarVisaoExposicaoFundoCanonica(input: {
  fundoId: string
  fundoNome: string
  politicaVersao: PoliticaOperacionalVersao
}): Promise<VisaoExposicaoOperacional | null> {
  const controle = {
    ativo: input.politicaVersao.controle_exposicao_logistica_ativo === true
      && Number(input.politicaVersao.limite_exposicao_em_transito_pct) > 0,
    limitePct: input.politicaVersao.limite_exposicao_em_transito_pct == null
      ? null
      : Number(input.politicaVersao.limite_exposicao_em_transito_pct),
  }
  if (!controle.ativo) return null

  const admin = createAdminClient()
  const { data, error } = await admin.from('exposicao_execucoes').select('*')
    .eq('fundo_id', input.fundoId)
    .eq('politica_operacional_versao_id', input.politicaVersao.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Não foi possível carregar a exposição canônica do fundo: ${error.message}`)

  return montarVisaoExposicaoFundo({
    controle,
    execucao: data as unknown as ExposureExecutionLike | null,
    fundoNome: input.fundoNome,
  })
}
