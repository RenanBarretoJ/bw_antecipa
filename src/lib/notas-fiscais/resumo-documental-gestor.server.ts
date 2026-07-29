import 'server-only'

import type { AppSupabaseClient } from '@/lib/auth/authorization'
import type { PoliticaNivelValidacao } from '@/lib/types/domain'
import {
  avaliarChecklistDaNotaComDados,
  type AvaliacaoChecklistAprovacao,
  type RequisitoAprovacaoComDados,
} from './avaliacao-checklist-aprovacao'

type InstanciaRow = {
  nota_fiscal_id: string
  politica_requisito_id: string
  tipo_documento_codigo_snapshot: string
  escopo_snapshot: string
  obrigatorio: boolean
  status: string
  documento_id: string | null
  versao_aprovada_id: string | null
  nivel_validacao_snapshot: PoliticaNivelValidacao
}

type PoliticaRequisitoRow = {
  id: string
  bloqueia_fluxo: boolean
  momento_obrigatorio: string | null
}

export type ResumoDocumentalEmLote = {
  avaliacoes: Map<string, AvaliacaoChecklistAprovacao>
  requisitos: RequisitoAprovacaoComDados[]
}

/**
 * Hidrata o estado documental de todas as NFs em um conjunto constante de
 * consultas. Nao carrega arquivos, paths, metadata ou historico completo.
 */
export async function carregarResumoDocumentalDasNotas(
  supabase: AppSupabaseClient,
  notaFiscalIds: string[],
): Promise<ResumoDocumentalEmLote> {
  const ids = Array.from(new Set(notaFiscalIds.filter(Boolean)))
  if (ids.length === 0) return { avaliacoes: new Map(), requisitos: [] }

  const { data: instanciasData, error: instanciasError } = await supabase
    .from('documento_requisito_instancias')
    .select(`
      nota_fiscal_id,
      politica_requisito_id,
      tipo_documento_codigo_snapshot,
      escopo_snapshot,
      obrigatorio,
      status,
      documento_id,
      versao_aprovada_id,
      nivel_validacao_snapshot
    `)
    .in('nota_fiscal_id', ids)
    .eq('escopo_snapshot', 'nf_pre_cessao')

  if (instanciasError) {
    throw new Error(`Nao foi possivel carregar o resumo documental: ${instanciasError.message}`)
  }

  const instancias = (instanciasData || []) as unknown as InstanciaRow[]
  const requisitoIds = Array.from(new Set(instancias.map((item) => item.politica_requisito_id)))
  const documentoIds = Array.from(new Set(
    instancias.map((item) => item.documento_id).filter(Boolean) as string[],
  ))
  const codigos = Array.from(new Set(instancias.map((item) => item.tipo_documento_codigo_snapshot)))

  const [requisitosResult, versoesResult, tiposResult] = await Promise.all([
    requisitoIds.length
      ? supabase
        .from('politica_requisitos_documentais')
        .select('id, bloqueia_fluxo, momento_obrigatorio')
        .in('id', requisitoIds)
      : Promise.resolve({ data: [], error: null }),
    documentoIds.length
      ? supabase
        .from('documento_versoes')
        .select('id, documento_id, numero_versao, status')
        .in('documento_id', documentoIds)
        .in('status', ['enviado', 'em_analise', 'aprovado', 'rejeitado'])
        .order('numero_versao', { ascending: false })
        .order('id', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    codigos.length
      ? supabase
        .from('documento_tipos')
        .select('codigo, nome')
        .in('codigo', codigos)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (requisitosResult.error) {
    throw new Error(`Nao foi possivel carregar os requisitos da politica: ${requisitosResult.error.message}`)
  }
  if (versoesResult.error) {
    throw new Error(`Nao foi possivel carregar as versoes documentais: ${versoesResult.error.message}`)
  }
  if (tiposResult.error) {
    throw new Error(`Nao foi possivel carregar os tipos documentais: ${tiposResult.error.message}`)
  }

  const requisitoPorId = new Map(
    ((requisitosResult.data || []) as unknown as PoliticaRequisitoRow[])
      .map((item) => [item.id, item]),
  )
  const nomePorCodigo = new Map(
    (tiposResult.data || []).map((item) => [item.codigo, item.nome]),
  )

  const versaoAtualPorDocumento = new Map<string, {
    id: string
    status: string
    ultimaAnalise: { resultado: string } | null
  }>()
  for (const versao of versoesResult.data || []) {
    if (!versaoAtualPorDocumento.has(versao.documento_id)) {
      versaoAtualPorDocumento.set(versao.documento_id, {
        id: versao.id,
        status: versao.status,
        ultimaAnalise: null,
      })
    }
  }

  const versaoAtualIds = Array.from(versaoAtualPorDocumento.values()).map((item) => item.id)
  const { data: analisesData, error: analisesError } = versaoAtualIds.length
    ? await supabase
      .from('documento_analises')
      .select('documento_versao_id, resultado, analisado_em')
      .in('documento_versao_id', versaoAtualIds)
      .order('analisado_em', { ascending: false })
      .order('id', { ascending: false })
    : { data: [], error: null }

  if (analisesError) {
    throw new Error(`Nao foi possivel carregar as analises documentais: ${analisesError.message}`)
  }

  const ultimaAnalisePorVersao = new Map<string, { resultado: string }>()
  for (const analise of analisesData || []) {
    if (!ultimaAnalisePorVersao.has(analise.documento_versao_id)) {
      ultimaAnalisePorVersao.set(analise.documento_versao_id, {
        resultado: analise.resultado,
      })
    }
  }
  for (const versao of versaoAtualPorDocumento.values()) {
    versao.ultimaAnalise = ultimaAnalisePorVersao.get(versao.id) || null
  }

  const requisitos: RequisitoAprovacaoComDados[] = instancias.map((instancia) => {
    const politica = requisitoPorId.get(instancia.politica_requisito_id)
    return {
      notaFiscalId: instancia.nota_fiscal_id,
      requisitoId: instancia.politica_requisito_id,
      nome: nomePorCodigo.get(instancia.tipo_documento_codigo_snapshot)
        || instancia.tipo_documento_codigo_snapshot,
      tipoDocumento: instancia.tipo_documento_codigo_snapshot,
      escopo: instancia.escopo_snapshot,
      obrigatorio: instancia.obrigatorio,
      bloqueiaFluxo: politica?.bloqueia_fluxo ?? false,
      momento: politica?.momento_obrigatorio || instancia.escopo_snapshot,
      regraValidade: instancia.nivel_validacao_snapshot,
      statusInstancia: instancia.status,
      documentoId: instancia.documento_id,
      versaoAprovadaId: instancia.versao_aprovada_id,
      versaoAtual: instancia.documento_id
        ? versaoAtualPorDocumento.get(instancia.documento_id) || null
        : null,
    }
  })

  const avaliacoes = new Map<string, AvaliacaoChecklistAprovacao>()
  for (const notaFiscalId of ids) {
    avaliacoes.set(notaFiscalId, avaliarChecklistDaNotaComDados({
      notaFiscalId,
      requisitos,
    }))
  }

  return { avaliacoes, requisitos }
}
