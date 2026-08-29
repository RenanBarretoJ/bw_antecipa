import 'server-only'

import type { AppSupabaseClient } from '@/lib/auth/authorization'
import type { PoliticaNivelValidacao } from '@/lib/types/domain'
import {
  avaliarElegibilidadeDocumentalDaNota,
  type AvaliacaoChecklistAprovacao,
  type InstanciaRequisitoAprovacao,
  type PoliticaDocumentalResolvidaNota,
  type RequisitoEsperadoAprovacao,
} from './avaliacao-checklist-aprovacao'

type NotaFiscalContextoRow = {
  id: string
  cedente_id: string
  cedente_fundo_id: string | null
  fundo_id: string | null
  arquivo_url: string | null
}

type InstanciaRow = {
  nota_fiscal_id: string
  politica_requisito_id: string
  politica_operacional_versao_id: string | null
  status: string
  documento_id: string | null
  versao_aprovada_id: string | null
}

type OperacaoRow = {
  id: string
  cedente_fundo_id: string | null
  politica_operacional_id: string | null
  politica_operacional_versao_id: string | null
  politica_snapshot: Record<string, unknown> | null
  politica_snapshot_hash: string | null
  created_at: string
}

type AtribuicaoRow = {
  cedente_fundo_id: string
  politica_operacional_id: string
  vigente_desde: string
}

type PoliticaRow = {
  id: string
  fundo_id: string
}

type PoliticaVersaoRow = {
  id: string
  politica_operacional_id: string
  fundo_id: string
  versao: number
}

type PoliticaRequisitoRow = {
  id: string
  politica_operacional_versao_id: string
  codigo: string
  tipo_documento_codigo: string
  escopo: string
  obrigatorio: boolean
  bloqueia_fluxo: boolean
  momento_obrigatorio: string | null
  nivel_validacao: PoliticaNivelValidacao
  ativo: boolean
}

type ContextoPoliticaNota = {
  politica: PoliticaDocumentalResolvidaNota
  requisitosSnapshotIds: Set<string> | null
}

export type ResumoDocumentalEmLote = {
  avaliacoes: Map<string, AvaliacaoChecklistAprovacao>
  requisitos: RequisitoEsperadoAprovacao[]
}

function registro(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringNaoVazia(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function requisitosPreCessaoDoSnapshot(snapshot: unknown): Set<string> | null {
  const raw = registro(snapshot)
  if (!raw || !Array.isArray(raw.requisitos)) return null

  const ids = new Set<string>()
  for (const item of raw.requisitos) {
    const requisito = registro(item)
    if (!requisito || requisito.ativo === false || requisito.escopo !== 'nf_pre_cessao') continue
    const id = stringNaoVazia(requisito.id)
    if (!id) return null
    ids.add(id)
  }
  return ids
}

function contextoOperacaoValido(
  nota: NotaFiscalContextoRow,
  operacao: OperacaoRow,
): boolean {
  const snapshot = registro(operacao.politica_snapshot)
  return Boolean(
    snapshot
    && operacao.politica_snapshot_hash
    && operacao.politica_operacional_id
    && operacao.politica_operacional_versao_id
    && nota.cedente_fundo_id
    && nota.fundo_id
    && operacao.cedente_fundo_id === nota.cedente_fundo_id
    && stringNaoVazia(snapshot.cedente_fundo_id) === nota.cedente_fundo_id
    && stringNaoVazia(snapshot.fundo_id) === nota.fundo_id
    && stringNaoVazia(snapshot.politica_operacional_id) === operacao.politica_operacional_id
    && stringNaoVazia(snapshot.politica_operacional_versao_id) === operacao.politica_operacional_versao_id,
  )
}

function politicaNaoResolvida(): ContextoPoliticaNota {
  return {
    politica: {
      resolvida: false,
      fonte: null,
      politicaId: null,
      versaoId: null,
    },
    requisitosSnapshotIds: null,
  }
}

/**
 * Hidrata o gate documental de todas as NFs em consultas agregadas. NFs sem
 * operacao usam a versao publicada aplicavel ao vinculo. NFs ligadas a uma
 * operacao usam a versao congelada e validada pelo snapshot.
 */
export async function carregarResumoDocumentalDasNotas(
  supabase: AppSupabaseClient,
  notaFiscalIds: string[],
): Promise<ResumoDocumentalEmLote> {
  const ids = Array.from(new Set(notaFiscalIds.filter(Boolean)))
  if (ids.length === 0) return { avaliacoes: new Map(), requisitos: [] }

  const [notasResult, instanciasResult, linksResult] = await Promise.all([
    supabase
      .from('notas_fiscais')
      .select('id, cedente_id, cedente_fundo_id, fundo_id, arquivo_url')
      .in('id', ids),
    supabase
      .from('documento_requisito_instancias')
      .select('nota_fiscal_id, politica_requisito_id, politica_operacional_versao_id, status, documento_id, versao_aprovada_id')
      .in('nota_fiscal_id', ids)
      .eq('escopo_snapshot', 'nf_pre_cessao'),
    supabase
      .from('operacoes_nfs')
      .select('nota_fiscal_id, operacao_id')
      .in('nota_fiscal_id', ids),
  ])

  if (notasResult.error) {
    throw new Error(`Nao foi possivel carregar o contexto das notas fiscais: ${notasResult.error.message}`)
  }
  if (instanciasResult.error) {
    throw new Error(`Nao foi possivel carregar o resumo documental: ${instanciasResult.error.message}`)
  }
  if (linksResult.error) {
    throw new Error(`Nao foi possivel carregar os vinculos operacionais das notas: ${linksResult.error.message}`)
  }

  const notas = (notasResult.data || []) as NotaFiscalContextoRow[]
  const instancias = (instanciasResult.data || []) as InstanciaRow[]
  const links = (linksResult.data || []) as Array<{ nota_fiscal_id: string; operacao_id: string }>
  const notasComLinkOperacional = new Set(links.map((item) => item.nota_fiscal_id))
  const operacaoIds = Array.from(new Set(links.map((item) => item.operacao_id)))

  const { data: operacoesData, error: operacoesError } = operacaoIds.length
    ? await supabase
      .from('operacoes')
      .select('id, cedente_fundo_id, politica_operacional_id, politica_operacional_versao_id, politica_snapshot, politica_snapshot_hash, created_at')
      .in('id', operacaoIds)
    : { data: [], error: null }
  if (operacoesError) {
    throw new Error(`Nao foi possivel carregar o contexto congelado das operacoes: ${operacoesError.message}`)
  }

  const operacaoPorId = new Map(
    ((operacoesData || []) as unknown as OperacaoRow[]).map((operacao) => [operacao.id, operacao]),
  )
  const operacoesPorNota = new Map<string, OperacaoRow[]>()
  for (const link of links) {
    const operacao = operacaoPorId.get(link.operacao_id)
    if (!operacao) continue
    const atuais = operacoesPorNota.get(link.nota_fiscal_id) || []
    atuais.push(operacao)
    operacoesPorNota.set(link.nota_fiscal_id, atuais)
  }
  for (const operacoes of operacoesPorNota.values()) {
    operacoes.sort((left, right) => right.created_at.localeCompare(left.created_at))
  }

  const operacaoAplicavelPorNota = new Map<string, OperacaoRow>()
  for (const nota of notas) {
    const operacao = (operacoesPorNota.get(nota.id) || [])[0]
    if (operacao) operacaoAplicavelPorNota.set(nota.id, operacao)
  }

  const notasPreOperacao = notas.filter((nota) => !notasComLinkOperacional.has(nota.id))
  const vinculoIds = Array.from(new Set(
    notasPreOperacao.map((nota) => nota.cedente_fundo_id).filter(Boolean) as string[],
  ))
  const now = new Date().toISOString()
  const { data: atribuicoesData, error: atribuicoesError } = vinculoIds.length
    ? await supabase
      .from('cedente_fundo_politicas')
      .select('cedente_fundo_id, politica_operacional_id, vigente_desde')
      .in('cedente_fundo_id', vinculoIds)
      .eq('status', 'ativa')
      .lte('vigente_desde', now)
      .or(`vigente_ate.is.null,vigente_ate.gt.${now}`)
      .order('vigente_desde', { ascending: false })
    : { data: [], error: null }
  if (atribuicoesError) {
    throw new Error(`Nao foi possivel carregar as politicas atribuidas: ${atribuicoesError.message}`)
  }

  const atribuicaoPorVinculo = new Map<string, AtribuicaoRow>()
  for (const atribuicao of (atribuicoesData || []) as AtribuicaoRow[]) {
    if (!atribuicaoPorVinculo.has(atribuicao.cedente_fundo_id)) {
      atribuicaoPorVinculo.set(atribuicao.cedente_fundo_id, atribuicao)
    }
  }
  const politicaIds = Array.from(new Set(
    [...atribuicaoPorVinculo.values()].map((item) => item.politica_operacional_id),
  ))
  const { data: politicasData, error: politicasError } = politicaIds.length
    ? await supabase
      .from('politicas_operacionais')
      .select('id, fundo_id')
      .in('id', politicaIds)
      .eq('status', 'ativa')
    : { data: [], error: null }
  if (politicasError) {
    throw new Error(`Nao foi possivel validar as politicas operacionais: ${politicasError.message}`)
  }

  const politicas = (politicasData || []) as PoliticaRow[]
  const politicaPorId = new Map(politicas.map((politica) => [politica.id, politica]))
  const versoesOperacaoIds = Array.from(new Set(
    [...operacaoAplicavelPorNota.values()]
      .map((operacao) => operacao.politica_operacional_versao_id)
      .filter(Boolean) as string[],
  ))
  const [versoesPublicadasResult, versoesOperacaoResult] = await Promise.all([
    politicaIds.length
      ? supabase
        .from('politica_operacional_versoes')
        .select('id, politica_operacional_id, fundo_id, versao')
        .in('politica_operacional_id', politicaIds)
        .eq('status', 'publicada')
        .not('publicada_em', 'is', null)
        .lte('vigente_desde', now)
        .or(`vigente_ate.is.null,vigente_ate.gt.${now}`)
        .order('versao', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    versoesOperacaoIds.length
      ? supabase
        .from('politica_operacional_versoes')
        .select('id, politica_operacional_id, fundo_id, versao')
        .in('id', versoesOperacaoIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (versoesPublicadasResult.error) {
    throw new Error(`Nao foi possivel carregar as versoes publicadas das politicas: ${versoesPublicadasResult.error.message}`)
  }
  if (versoesOperacaoResult.error) {
    throw new Error(`Nao foi possivel carregar as versoes congeladas das operacoes: ${versoesOperacaoResult.error.message}`)
  }

  const versaoPublicadaPorPolitica = new Map<string, PoliticaVersaoRow>()
  for (const versao of (versoesPublicadasResult.data || []) as PoliticaVersaoRow[]) {
    if (!versaoPublicadaPorPolitica.has(versao.politica_operacional_id)) {
      versaoPublicadaPorPolitica.set(versao.politica_operacional_id, versao)
    }
  }
  const versaoOperacaoPorId = new Map(
    ((versoesOperacaoResult.data || []) as PoliticaVersaoRow[]).map((versao) => [versao.id, versao]),
  )

  const contextoPorNota = new Map<string, ContextoPoliticaNota>()
  for (const nota of notas) {
    const operacao = operacaoAplicavelPorNota.get(nota.id)
    if (operacao) {
      const versao = operacao.politica_operacional_versao_id
        ? versaoOperacaoPorId.get(operacao.politica_operacional_versao_id)
        : null
      const requisitosSnapshotIds = requisitosPreCessaoDoSnapshot(operacao.politica_snapshot)
      const valido = contextoOperacaoValido(nota, operacao)
        && versao
        && versao.politica_operacional_id === operacao.politica_operacional_id
        && versao.fundo_id === nota.fundo_id
        && requisitosSnapshotIds !== null
      contextoPorNota.set(nota.id, valido
        ? {
          politica: {
            resolvida: true,
            fonte: 'snapshot_operacao',
            politicaId: operacao.politica_operacional_id,
            versaoId: versao.id,
          },
          requisitosSnapshotIds,
        }
        : politicaNaoResolvida())
      continue
    }

    // Uma NF com vinculo operacional nunca pode cair silenciosamente na
    // politica vigente. Se a operacao ficou invisivel pela RLS ou inconsistente,
    // o gate falha fechado e preserva o contexto historico.
    if (notasComLinkOperacional.has(nota.id)) {
      contextoPorNota.set(nota.id, politicaNaoResolvida())
      continue
    }

    if (!nota.cedente_fundo_id || !nota.fundo_id) {
      contextoPorNota.set(nota.id, politicaNaoResolvida())
      continue
    }
    const atribuicao = atribuicaoPorVinculo.get(nota.cedente_fundo_id)
    const politica = atribuicao ? politicaPorId.get(atribuicao.politica_operacional_id) : null
    const versao = politica ? versaoPublicadaPorPolitica.get(politica.id) : null
    const valido = politica && versao
      && politica.fundo_id === nota.fundo_id
      && versao.fundo_id === nota.fundo_id
      && versao.politica_operacional_id === politica.id
    contextoPorNota.set(nota.id, valido
      ? {
        politica: {
          resolvida: true,
          fonte: 'politica_publicada',
          politicaId: politica.id,
          versaoId: versao.id,
        },
        requisitosSnapshotIds: null,
      }
      : politicaNaoResolvida())
  }

  const versaoIds = Array.from(new Set(
    [...contextoPorNota.values()]
      .map((contexto) => contexto.politica.versaoId)
      .filter(Boolean) as string[],
  ))
  const { data: requisitosData, error: requisitosError } = versaoIds.length
    ? await supabase
      .from('politica_requisitos_documentais')
      .select('id, politica_operacional_versao_id, codigo, tipo_documento_codigo, escopo, obrigatorio, bloqueia_fluxo, momento_obrigatorio, nivel_validacao, ativo')
      .in('politica_operacional_versao_id', versaoIds)
      .eq('ativo', true)
      .eq('escopo', 'nf_pre_cessao')
    : { data: [], error: null }
  if (requisitosError) {
    throw new Error(`Nao foi possivel carregar os requisitos esperados das politicas: ${requisitosError.message}`)
  }

  const requisitosRows = (requisitosData || []) as PoliticaRequisitoRow[]
  const requisitosRowsPorVersao = new Map<string, PoliticaRequisitoRow[]>()
  for (const requisito of requisitosRows) {
    const atuais = requisitosRowsPorVersao.get(requisito.politica_operacional_versao_id) || []
    atuais.push(requisito)
    requisitosRowsPorVersao.set(requisito.politica_operacional_versao_id, atuais)
  }
  const codigos = Array.from(new Set(requisitosRows.map((item) => item.tipo_documento_codigo)))
  for (const [notaId, contexto] of contextoPorNota) {
    if (!contexto.politica.resolvida || !contexto.requisitosSnapshotIds) continue
    const requisitosDaVersao = requisitosRowsPorVersao.get(contexto.politica.versaoId || '') || []
    const idsDaVersao = new Set(requisitosDaVersao.map((item) => item.id))
    const snapshotIntegro = [...contexto.requisitosSnapshotIds].every((id) => idsDaVersao.has(id))
    if (!snapshotIntegro) contextoPorNota.set(notaId, politicaNaoResolvida())
  }

  const instanciasRelevantes = instancias.filter((instancia) => {
    const contexto = contextoPorNota.get(instancia.nota_fiscal_id)
    return contexto?.politica.resolvida
      && instancia.politica_operacional_versao_id === contexto.politica.versaoId
  })
  const documentoIds = Array.from(new Set(
    instanciasRelevantes.map((item) => item.documento_id).filter(Boolean) as string[],
  ))
  const [tiposResult, versoesDocumentaisResult] = await Promise.all([
    codigos.length
      ? supabase.from('documento_tipos').select('codigo, nome').in('codigo', codigos)
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
  ])
  if (tiposResult.error) {
    throw new Error(`Nao foi possivel carregar os tipos documentais: ${tiposResult.error.message}`)
  }
  if (versoesDocumentaisResult.error) {
    throw new Error(`Nao foi possivel carregar as versoes documentais: ${versoesDocumentaisResult.error.message}`)
  }

  const nomePorCodigo = new Map((tiposResult.data || []).map((item) => [item.codigo, item.nome]))
  const versaoAtualPorDocumento = new Map<string, {
    id: string
    status: string
    ultimaAnalise: { resultado: string } | null
  }>()
  for (const versao of versoesDocumentaisResult.data || []) {
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
      ultimaAnalisePorVersao.set(analise.documento_versao_id, { resultado: analise.resultado })
    }
  }
  for (const versao of versaoAtualPorDocumento.values()) {
    versao.ultimaAnalise = ultimaAnalisePorVersao.get(versao.id) || null
  }

  const requisitosEsperados: RequisitoEsperadoAprovacao[] = requisitosRows.map((requisito) => ({
    id: requisito.id,
    nome: nomePorCodigo.get(requisito.tipo_documento_codigo)
      || requisito.codigo
      || requisito.tipo_documento_codigo,
    tipoDocumento: requisito.tipo_documento_codigo,
    escopo: requisito.escopo,
    obrigatorio: requisito.obrigatorio,
    bloqueiaFluxo: requisito.bloqueia_fluxo,
    momento: requisito.momento_obrigatorio || requisito.escopo,
    regraValidade: requisito.nivel_validacao,
    ativo: requisito.ativo,
  }))
  const requisitoEsperadoPorId = new Map(requisitosEsperados.map((requisito) => [requisito.id, requisito]))
  const instanciasAprovacao: InstanciaRequisitoAprovacao[] = instanciasRelevantes.map((instancia) => ({
    notaFiscalId: instancia.nota_fiscal_id,
    requisitoId: instancia.politica_requisito_id,
    politicaVersaoId: instancia.politica_operacional_versao_id,
    statusInstancia: instancia.status,
    documentoId: instancia.documento_id,
    versaoAprovadaId: instancia.versao_aprovada_id,
    versaoAtual: instancia.documento_id
      ? versaoAtualPorDocumento.get(instancia.documento_id) || null
      : null,
  }))
  const instanciasPorNota = new Map<string, InstanciaRequisitoAprovacao[]>()
  for (const instancia of instanciasAprovacao) {
    const atuais = instanciasPorNota.get(instancia.notaFiscalId) || []
    atuais.push(instancia)
    instanciasPorNota.set(instancia.notaFiscalId, atuais)
  }

  const avaliacoes = new Map<string, AvaliacaoChecklistAprovacao>()
  for (const nota of notas) {
    const contexto = contextoPorNota.get(nota.id) || politicaNaoResolvida()
    const requisitosDaVersao = (requisitosRowsPorVersao.get(contexto.politica.versaoId || '') || [])
      .filter((requisito) => (
        !contexto.requisitosSnapshotIds || contexto.requisitosSnapshotIds.has(requisito.id)
      ))
      .map((requisito) => requisitoEsperadoPorId.get(requisito.id))
      .filter(Boolean) as RequisitoEsperadoAprovacao[]
    const requisitosIdsDaNota = new Set(requisitosDaVersao.map((requisito) => requisito.id))
    const instanciasDaNota = (instanciasPorNota.get(nota.id) || [])
      .filter((instancia) => requisitosIdsDaNota.has(instancia.requisitoId))
    avaliacoes.set(nota.id, avaliarElegibilidadeDocumentalDaNota({
      notaFiscalId: nota.id,
      politica: contexto.politica,
      requisitosEsperados: requisitosDaVersao,
      instancias: instanciasDaNota,
      arquivoOriginal: nota.arquivo_url,
    }))
  }

  return { avaliacoes, requisitos: requisitosEsperados }
}
