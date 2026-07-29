import 'server-only'

import type { AppSupabaseClient } from '@/lib/auth/authorization'
import type { PoliticaNivelValidacao } from '@/lib/types/domain'
import type {
  NotaFiscalElegibilidadeComDados,
  RequisitoElegibilidadeComDados,
} from '@/lib/notas-fiscais/listagem'
import {
  avaliarLoteDocumentalParaOperacao,
} from './elegibilidade-documental'

type RequisitoPolitica = {
  id: string
  tipo_documento_codigo: string
  escopo: string
  obrigatorio: boolean
  nivel_validacao: PoliticaNivelValidacao
  momento_obrigatorio: string | null
  bloqueia_fluxo: boolean
}

function requisitoVazio(
  notaFiscalId: string,
  requisito: RequisitoPolitica,
): RequisitoElegibilidadeComDados {
  return {
    id: requisito.id,
    notaFiscalId,
    codigo: requisito.tipo_documento_codigo,
    escopo: requisito.escopo,
    obrigatorio: requisito.obrigatorio,
    bloqueiaFluxo: requisito.bloqueia_fluxo,
    momentoObrigatorio: requisito.momento_obrigatorio || requisito.escopo,
    nivelValidacao: requisito.nivel_validacao,
    statusInstancia: 'pendente',
    documentoId: null,
    versaoAprovadaId: null,
    versaoAtual: null,
  }
}

export async function carregarElegibilidadeDocumentalOperacaoEmLote(input: {
  client: AppSupabaseClient
  notas: NotaFiscalElegibilidadeComDados[]
  politicaVersaoId: string
}) {
  const ids = [...new Set(input.notas.map((nota) => nota.id))]
  if (!ids.length) return new Map()

  const [{ data: requisitosData, error: requisitosError }, { data: instanciasData, error: instanciasError }] = await Promise.all([
    input.client
      .from('politica_requisitos_documentais')
      .select('id, tipo_documento_codigo, escopo, obrigatorio, nivel_validacao, momento_obrigatorio, bloqueia_fluxo')
      .eq('politica_operacional_versao_id', input.politicaVersaoId)
      .eq('ativo', true)
      .eq('escopo', 'nf_pre_cessao')
      .order('ordem', { ascending: true }),
    input.client
      .from('documento_requisito_instancias')
      .select('id, nota_fiscal_id, politica_requisito_id, tipo_documento_codigo_snapshot, escopo_snapshot, obrigatorio, status, documento_id, versao_aprovada_id, nivel_validacao_snapshot')
      .in('nota_fiscal_id', ids)
      .eq('politica_operacional_versao_id', input.politicaVersaoId)
      .eq('escopo_snapshot', 'nf_pre_cessao'),
  ])
  if (requisitosError) throw new Error(`Nao foi possivel carregar os requisitos da politica: ${requisitosError.message}`)
  if (instanciasError) throw new Error(`Nao foi possivel carregar os requisitos documentais em lote: ${instanciasError.message}`)

  const requisitos = (requisitosData || []) as RequisitoPolitica[]
  const instancias = (instanciasData || []) as Array<{
    id: string
    nota_fiscal_id: string
    politica_requisito_id: string
    tipo_documento_codigo_snapshot: string
    escopo_snapshot: string
    obrigatorio: boolean
    status: string
    documento_id: string | null
    versao_aprovada_id: string | null
    nivel_validacao_snapshot: PoliticaNivelValidacao
  }>
  const documentoIds = [...new Set(instancias.map((item) => item.documento_id).filter(Boolean) as string[])]
  const { data: versoesData, error: versoesError } = documentoIds.length
    ? await input.client
      .from('documento_versoes')
      .select('id, documento_id, numero_versao, status')
      .in('documento_id', documentoIds)
      .order('numero_versao', { ascending: false })
    : { data: [], error: null }
  if (versoesError) throw new Error(`Nao foi possivel carregar as versoes documentais em lote: ${versoesError.message}`)

  const versaoAtualPorDocumento = new Map<string, {
    id: string
    status: string
    ultimaAnalise: { resultado: string } | null
  }>()
  for (const versao of versoesData || []) {
    if (!versaoAtualPorDocumento.has(versao.documento_id)) {
      versaoAtualPorDocumento.set(versao.documento_id, {
        id: versao.id,
        status: versao.status,
        ultimaAnalise: null,
      })
    }
  }
  const versaoIds = [...versaoAtualPorDocumento.values()].map((item) => item.id)
  const { data: analisesData, error: analisesError } = versaoIds.length
    ? await input.client
      .from('documento_analises')
      .select('documento_versao_id, resultado, analisado_em')
      .in('documento_versao_id', versaoIds)
      .order('analisado_em', { ascending: false })
    : { data: [], error: null }
  if (analisesError) throw new Error(`Nao foi possivel carregar as analises documentais em lote: ${analisesError.message}`)

  const ultimaAnalise = new Map<string, { resultado: string }>()
  for (const analise of analisesData || []) {
    if (!ultimaAnalise.has(analise.documento_versao_id)) {
      ultimaAnalise.set(analise.documento_versao_id, { resultado: analise.resultado })
    }
  }
  for (const versao of versaoAtualPorDocumento.values()) {
    versao.ultimaAnalise = ultimaAnalise.get(versao.id) || null
  }

  const instanciaPorNotaRequisito = new Map(
    instancias.map((item) => [`${item.nota_fiscal_id}:${item.politica_requisito_id}`, item]),
  )
  const requisitosPorNota = new Map<string, RequisitoElegibilidadeComDados[]>()
  for (const nota of input.notas) {
    requisitosPorNota.set(nota.id, requisitos.map((requisito) => {
      const instancia = instanciaPorNotaRequisito.get(`${nota.id}:${requisito.id}`)
      if (!instancia) return requisitoVazio(nota.id, requisito)
      return {
        id: requisito.id,
        notaFiscalId: nota.id,
        codigo: instancia.tipo_documento_codigo_snapshot,
        escopo: instancia.escopo_snapshot,
        obrigatorio: instancia.obrigatorio,
        bloqueiaFluxo: requisito.bloqueia_fluxo,
        momentoObrigatorio: requisito.momento_obrigatorio || requisito.escopo,
        nivelValidacao: instancia.nivel_validacao_snapshot,
        statusInstancia: instancia.status,
        documentoId: instancia.documento_id,
        versaoAprovadaId: instancia.versao_aprovada_id,
        versaoAtual: instancia.documento_id
          ? versaoAtualPorDocumento.get(instancia.documento_id) || null
          : null,
      }
    }))
  }
  return avaliarLoteDocumentalParaOperacao({
    notas: input.notas,
    requisitosPorNota,
  })
}
