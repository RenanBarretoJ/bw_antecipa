import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'
import type { PoliticaOperacionalVersao } from '@/types/database'
import { classificarGateRisco } from './classificador'
import { candidateProjection as projetarCandidatoOperacaoCanonica } from './processor.server'
import type { RiskPolicy } from './types'
import {
  montarVisaoExposicaoFundo,
  montarVisaoExposicaoOperacao,
  resolverControleExposicaoDoSnapshot,
  type ExposureExecutionLike,
  type RiskExecutionLike,
  type VisaoExposicaoOperacional,
} from './visao-operacional'

type Row = Record<string, unknown> & { id: string }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value)
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function count(value: unknown): number {
  return finiteNumber(value) || 0
}

function politicaDePreview(snapshot: unknown, limitePct: number): RiskPolicy {
  const raw = asRecord(snapshot)
  return {
    active: true,
    limitPercent: String(limitePct),
    inclusiveLimit: raw.limite_inclusivo !== false,
    missingPlTreatment: 'BLOQUEAR',
    indeterminateTreatment: 'REVISAO_MANUAL',
    unmatchedTreatment: 'BLOQUEAR',
    unincorporatedOperationTreatment: 'BLOQUEAR',
    partialLiquidationTreatment: 'SINALIZAR',
  }
}

function rotuloOrigemPl(importacao: Row | null): string | null {
  if (!importacao) return null
  const origem = text(importacao.origem)
  const provedor = text(importacao.provedor)
  if (origem === 'GOLDEN_DATASET' || /(^|[_-])(qa|golden)([_-]|$)/i.test(provedor || '')) return 'QA SYNTHETIC'
  return [origem, provedor].filter(Boolean).join(' · ') || null
}

async function carregarOrigemPl(admin: ReturnType<typeof createAdminClient>, importacaoId: unknown) {
  if (!importacaoId) return null
  const { data, error } = await admin.from('importacoes_financeiras')
    .select('id,origem,provedor')
    .eq('id', String(importacaoId))
    .maybeSingle()
  if (error) throw new Error(`Não foi possível carregar a origem do PL: ${error.message}`)
  return rotuloOrigemPl(data as unknown as Row | null)
}

export async function carregarVisaoExposicaoOperacaoCanonica(input: {
  operacaoId: string
  fundoId: string
  politicaSnapshot: unknown
  riscoExecucaoId?: string | null
}): Promise<VisaoExposicaoOperacional | null> {
  const controle = resolverControleExposicaoDoSnapshot(input.politicaSnapshot)
  if (!controle.ativo || controle.limitePct === null) return null

  const admin = createAdminClient()
  const snapshot = asRecord(input.politicaSnapshot)
  const politicaVersaoId = text(snapshot.politica_operacional_versao_id)
  let execucoes: unknown[] = []
  let error: { message: string } | null = null
  if (input.riscoExecucaoId) {
    let query = admin.from('risco_execucoes').select('*')
      .eq('id', input.riscoExecucaoId)
      .eq('operacao_id', input.operacaoId)
      .eq('fundo_id', input.fundoId)
      .eq('escopo', 'OPERACAO')
    if (politicaVersaoId) query = query.eq('politica_operacional_versao_id', politicaVersaoId)
    const result = await query.limit(1)
    execucoes = result.data || []
    error = result.error
  }

  if (error) throw new Error(`Não foi possível carregar a avaliação canônica da operação: ${error.message}`)
  const execucao = ((execucoes || []) as Row[])[0] || null

  const [motivosResult, exposicaoResult] = execucao
    ? await Promise.all([
        admin.from('risco_motivos').select('codigo').eq('risco_execucao_id', execucao.id).order('created_at'),
        execucao.exposicao_execucao_id
          ? admin.from('exposicao_execucoes').select('*').eq('id', String(execucao.exposicao_execucao_id)).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])
    : [{ data: [], error: null }, { data: null, error: null }]

  if (motivosResult.error) throw new Error(`Não foi possível carregar os motivos da avaliação: ${motivosResult.error.message}`)
  if (exposicaoResult.error) throw new Error(`Não foi possível carregar a data-base da exposição: ${exposicaoResult.error.message}`)

  if (execucao) {
    const exposicao = exposicaoResult.data as unknown as Row | null
    return montarVisaoExposicaoOperacao({
      controle,
      execucao: execucao as unknown as RiskExecutionLike,
      motivos: ((motivosResult.data || []) as Array<{ codigo: string }>).map((item) => item.codigo),
      dataBasePl: text(exposicao?.data_referencia_pl),
      origemPl: await carregarOrigemPl(admin, exposicao?.carteira_importacao_id),
    })
  }

  const operacaoResult = await admin.from('operacoes')
    .select('id,cedente_fundo_id,taxa_desconto,politica_operacional_versao_id')
    .eq('id', input.operacaoId)
    .maybeSingle()
  if (operacaoResult.error) throw new Error(`Não foi possível carregar a operação candidata: ${operacaoResult.error.message}`)
  const operacao = operacaoResult.data as unknown as Row | null
  const contextoValido = Boolean(
    operacao
    && text(operacao.cedente_fundo_id) === text(snapshot.cedente_fundo_id)
    && (!politicaVersaoId || text(operacao.politica_operacional_versao_id) === politicaVersaoId),
  )

  let exposicaoQuery = admin.from('exposicao_execucoes').select('*')
    .eq('fundo_id', input.fundoId)
  if (politicaVersaoId) exposicaoQuery = exposicaoQuery.eq('politica_operacional_versao_id', politicaVersaoId)
  const exposicaoAtualResult = await exposicaoQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (exposicaoAtualResult.error) throw new Error(`Não foi possível carregar a base canônica da exposição: ${exposicaoAtualResult.error.message}`)

  const exposicao = exposicaoAtualResult.data as unknown as Row | null
  const taxaDesconto = finiteNumber(operacao?.taxa_desconto)
  let candidato: Awaited<ReturnType<typeof projetarCandidatoOperacaoCanonica>> | null = null
  let falhaPreview: string | null = null
  if (!contextoValido) {
    falhaPreview = 'Não foi possível validar o contexto congelado desta operação.'
  } else if (taxaDesconto === null || taxaDesconto < 0) {
    falhaPreview = 'Não foi possível calcular o impacto porque a taxa da operação está indisponível.'
  } else {
    try {
      candidato = await projetarCandidatoOperacaoCanonica(admin, {
        operacaoId: input.operacaoId,
        taxaDesconto,
        fundoId: input.fundoId,
      })
      if (candidato.acquisitionValue === null || candidato.missingAcquisitionCount > 0) {
        falhaPreview = 'Não foi possível determinar o valor candidato de todas as parcelas da operação.'
      }
    } catch {
      falhaPreview = 'Não foi possível calcular o valor candidato com a memória financeira da operação.'
    }
  }

  const candidatoCalculavel = Boolean(
    candidato
    && candidato.acquisitionValue !== null
    && candidato.missingAcquisitionCount === 0,
  )
  const classificacao = classificarGateRisco({
    policy: politicaDePreview(input.politicaSnapshot, controle.limitePct),
    exposureStatus: candidatoCalculavel
      ? text(exposicao?.status) || 'AVALIACAO_RISCO_INDISPONIVEL'
      : 'AVALIACAO_RISCO_INDISPONIVEL',
    currentPercent: text(exposicao?.percentual_exposicao),
    currentExposureValue: text(exposicao?.exposicao_em_transito_total),
    netAssetValueD2: text(exposicao?.patrimonio_liquido_d2),
    indeterminateCount: count(exposicao?.quantidade_indeterminada),
    indeterminateValue: text(exposicao?.valor_indeterminado),
    unmatchedCount: count(exposicao?.quantidade_sem_match),
    unmatchedValue: text(exposicao?.valor_sem_match),
    missingAcquisitionCount: count(exposicao?.quantidade_valor_aquisicao_ausente),
    unincorporatedOperationCount: count(exposicao?.quantidade_nao_incorporada),
    unincorporatedOperationValue: text(exposicao?.operacoes_nao_incorporadas_valor),
    hasPartialLiquidation: Array.isArray(exposicao?.flags_qualidade) && exposicao.flags_qualidade.includes('TEM_LIQUIDACAO_PARCIAL'),
    candidate: candidato,
  })
  const execucaoPreview: RiskExecutionLike = {
    status_tecnico: classificacao.technicalStatus,
    patrimonio_liquido_d2: exposicao?.patrimonio_liquido_d2,
    exposicao_atual_valor: exposicao?.exposicao_em_transito_total,
    exposicao_atual_pct: classificacao.currentPercent,
    operacao_valor_aquisicao: candidato?.acquisitionValue,
    operacao_valor_em_transito: candidato?.transitValue,
    exposicao_projetada_valor: classificacao.projectedExposureValue,
    exposicao_projetada_pct: classificacao.projectedPercent,
    limite_pct: controle.limitePct,
  }

  return montarVisaoExposicaoOperacao({
    controle,
    execucao: execucaoPreview,
    motivos: classificacao.reasons.map((item) => item.code),
    dataBasePl: text(exposicao?.data_referencia_pl),
    origemPl: await carregarOrigemPl(admin, exposicao?.carteira_importacao_id),
    motivoFallback: falhaPreview,
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
