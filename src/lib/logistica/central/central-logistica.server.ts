import 'server-only'

import { requireGestor } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { resolverAplicabilidadeLogistica } from '@/lib/logistica/acompanhamento-operacao'
import { resolverFamiliaDocumentalLogistica, type FamiliaDocumentalLogistica } from '@/lib/logistica/evidencias-logisticas'
import { createClient } from '@/lib/supabase/server'
import {
  agregarCtesCentral,
  complementarSituacaoNf,
  filtrarNotasCentral,
  indicadoresCentralLogistica,
  ordenarNotasCentral,
  projetarDocumentoLogistico,
  resolverDataCessaoConfiavel,
  resumirCentralLogistica,
  statusHistorico,
  type AnaliseDocumentoCentralRaw,
  type DocumentoCentralRaw,
  type VersaoDocumentoCentralRaw,
} from './dominio'
import type {
  CentralLogisticaData,
  CteLogisticoResumo,
  FiltrosCentralLogistica,
  LogisticaNfResumo,
  OpcaoFiltroLogistica,
} from './tipos'

const TAMANHO_LOTE = 100
const TAMANHO_PAGINA_BANCO = 900
const CODIGOS_LOGISTICOS = ['cte', 'cte_xml', 'cte_pdf_dacte', 'cte_dacte_pdf', 'dacte', 'canhoto', 'comprovante_entrega', 'comprovante_de_entrega']

type ErroConsulta = { message: string } | null
type ResultadoConsulta<T> = { data: T[] | null; error: ErroConsulta }

type NfRow = {
  id: string; numero_nf: string; chave_acesso: string | null; cedente_id: string
  cnpj_emitente: string; razao_social_emitente: string; cnpj_destinatario: string
  razao_social_destinatario: string; valor_bruto: number; data_emissao: string
  data_vencimento: string; updated_at: string
}
type OperacaoRow = {
  id: string; cedente_fundo_id: string | null; status: string; politica_snapshot: unknown
  created_at: string; aprovado_em: string | null; cessao_efetivada_em: string | null
}
type OperacaoNfRow = { operacao_id: string; nota_fiscal_id: string }
type EntregaRow = {
  id: string; operacao_id: string; nota_fiscal_id: string; status_entrega: string
  cessao_efetivada_em: string | null; data_limite_cte: string | null
  data_limite_canhoto: string | null; updated_at: string
}
type RequisitoRow = {
  id: string; nota_fiscal_id: string | null; operacao_id: string | null
  nota_fiscal_entrega_id: string | null; tipo_documento_codigo_snapshot: string
  obrigatorio: boolean; documento_id: string | null; versao_aprovada_id: string | null
  prazo_limite: string | null; status: string; updated_at: string
}
type EvidenciaRow = {
  id: string; nota_fiscal_id: string; familia_documental: FamiliaDocumentalLogistica
  documento_id: string; documento_versao_atual_id: string; primeiro_upload_em: string
  ultimo_upload_em: string; updated_at: string
}
type MemoriaRow = {
  nota_fiscal_id: string; operacao_id: string; etapa: string; gate_exigido: boolean
  status_logistico: 'ENTREGUE' | 'EM_TRANSITO' | 'INDETERMINADA'; created_at: string
}
type CteRow = {
  id: string; cedente_id: string; chave_cte: string | null; numero: string | null
  documento_id: string | null; documento_versao_atual_id: string | null
  documento_versao_aprovada_id: string | null; status: string; created_at: string; updated_at: string
}
type CteNfRow = { cte_id: string; nota_fiscal_id: string }
type CanhotoRow = {
  id: string; nota_fiscal_entrega_id: string; documento_id: string | null
  documento_versao_atual_id: string | null; documento_versao_aprovada_id: string | null
  status: string; created_at: string; updated_at: string
}
type PostergacaoRow = {
  nota_fiscal_id: string; prazo_original_upload_canhoto: string
  nova_previsao_upload_canhoto: string; postergacao_comunicada_em: string
}
type VersaoRow = {
  id: string; documento_id: string; numero_versao: number; nome_original: string
  status: string; enviado_em: string
}
type AnaliseRow = {
  id: string; documento_versao_id: string; resultado: string
  analisado_em: string; analisado_por: string | null
}

function falhar(contexto: string, error: ErroConsulta) {
  if (error) throw new Error(`${contexto}: ${error.message}`)
}

async function coletarPaginas<T>(
  contexto: string,
  consultar: (inicio: number, fim: number) => PromiseLike<ResultadoConsulta<T>>,
): Promise<T[]> {
  const rows: T[] = []
  let inicio = 0
  while (true) {
    const resultado = await consultar(inicio, inicio + TAMANHO_PAGINA_BANCO - 1)
    falhar(contexto, resultado.error)
    const pagina = resultado.data || []
    rows.push(...pagina)
    if (pagina.length < TAMANHO_PAGINA_BANCO) return rows
    inicio += TAMANHO_PAGINA_BANCO
  }
}

function lotes<T>(items: T[], tamanho = TAMANHO_LOTE) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += tamanho) result.push(items.slice(index, index + tamanho))
  return result
}

async function consultarPorIds<T>(
  ids: string[],
  contexto: string,
  consultar: (idsLote: string[], inicio: number, fim: number) => PromiseLike<ResultadoConsulta<T>>,
) {
  const rows: T[] = []
  for (const idsLote of lotes([...new Set(ids)])) {
    let inicio = 0
    while (true) {
      const resultado = await consultar(idsLote, inicio, inicio + TAMANHO_PAGINA_BANCO - 1)
      falhar(contexto, resultado.error)
      const pagina = resultado.data || []
      rows.push(...pagina)
      if (pagina.length < TAMANHO_PAGINA_BANCO) break
      inicio += TAMANHO_PAGINA_BANCO
    }
  }
  return rows
}

function agrupar<T>(items: T[], key: (item: T) => string | null | undefined) {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const value = key(item)
    if (!value) continue
    map.set(value, [...(map.get(value) || []), item])
  }
  return map
}

function opcao(value: string, label: string): OpcaoFiltroLogistica {
  return { value, label }
}

function semDocumento(familia: FamiliaDocumentalLogistica, obrigatorio: boolean, prazoOriginal: string | null, novaPrevisao: string | null): DocumentoCentralRaw {
  return { familia, documentoId: null, versaoAprovadaId: null, obrigatorio, prazoOriginal, novaPrevisao, versoes: [], analises: [] }
}

function documentoPorFamilia(input: {
  familia: FamiliaDocumentalLogistica
  refs: Array<{ documentoId: string | null; versaoAprovadaId: string | null; obrigatorio: boolean; prazoOriginal: string | null }>
  novaPrevisao: string | null
  versoesPorDocumento: Map<string, VersaoDocumentoCentralRaw[]>
  analisesPorVersao: Map<string, AnaliseDocumentoCentralRaw[]>
}): DocumentoCentralRaw {
  const refs = input.refs.filter((item) => item.documentoId)
  const versoes = refs.flatMap((item) => input.versoesPorDocumento.get(item.documentoId || '') || [])
  const atual = [...versoes].sort((a, b) => b.enviadoEm.localeCompare(a.enviadoEm) || b.numero - a.numero)[0] ?? null
  const refAtual = refs.find((item) => item.documentoId === atual?.documentoId) ?? refs[0]
  const versaoAprovadaId = refs.map((item) => item.versaoAprovadaId).find(Boolean) ?? null
  return {
    familia: input.familia,
    documentoId: atual?.documentoId ?? refAtual?.documentoId ?? null,
    versaoAprovadaId,
    obrigatorio: input.refs.some((item) => item.obrigatorio),
    prazoOriginal: input.refs.map((item) => item.prazoOriginal).filter(Boolean).sort()[0] ?? null,
    novaPrevisao: input.novaPrevisao,
    versoes,
    analises: versoes.flatMap((versao) => input.analisesPorVersao.get(versao.id) || []),
  }
}

export async function carregarCentralLogistica(
  filtros: FiltrosCentralLogistica,
  opcoes: { semPaginacao?: boolean } = {},
): Promise<CentralLogisticaData> {
  const supabase = await createClient()
  const auth = await requireGestor(supabase)
  const fundo = await resolverContextoFundoGestor(auth)

  const vinculos = await coletarPaginas<{ id: string }>('Nao foi possivel consultar os vinculos do fundo', (inicio, fim) => supabase
    .from('cedente_fundos').select('id').eq('fundo_id', fundo.fundoId).range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<{ id: string }>>)
  const vinculoIds = vinculos.map((item) => item.id)

  const [notas, operacoes, evidencias, memorias, ctes] = await Promise.all([
    coletarPaginas<NfRow>('Nao foi possivel consultar as notas fiscais da logistica', (inicio, fim) => supabase
      .from('notas_fiscais')
      .select('id, numero_nf, chave_acesso, cedente_id, cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, data_emissao, data_vencimento, updated_at')
      .eq('fundo_id', fundo.fundoId).order('id').range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<NfRow>>),
    vinculoIds.length ? consultarPorIds<OperacaoRow>(vinculoIds, 'Nao foi possivel consultar as operacoes da logistica', (ids, inicio, fim) => supabase
      .from('operacoes')
      .select('id, cedente_fundo_id, status, politica_snapshot, created_at, aprovado_em, cessao_efetivada_em')
      .in('cedente_fundo_id', ids).order('created_at', { ascending: false }).order('id').range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<OperacaoRow>>) : [],
    coletarPaginas<EvidenciaRow>('Nao foi possivel consultar as evidencias logisticas antecipadas', (inicio, fim) => supabase
      .from('evidencias_logisticas_antecipadas')
      .select('id, nota_fiscal_id, familia_documental, documento_id, documento_versao_atual_id, primeiro_upload_em, ultimo_upload_em, updated_at')
      .eq('fundo_id', fundo.fundoId).order('id').range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<EvidenciaRow>>),
    coletarPaginas<MemoriaRow>('Nao foi possivel consultar as memorias logisticas', (inicio, fim) => supabase
      .from('operacao_nf_logistica_memorias')
      .select('nota_fiscal_id, operacao_id, etapa, gate_exigido, status_logistico, created_at')
      .eq('fundo_id', fundo.fundoId).order('id').range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<MemoriaRow>>),
    coletarPaginas<CteRow>('Nao foi possivel consultar os CT-es do fundo', (inicio, fim) => supabase
      .from('ctes')
      .select('id, cedente_id, chave_cte, numero, documento_id, documento_versao_atual_id, documento_versao_aprovada_id, status, created_at, updated_at')
      .eq('fundo_id', fundo.fundoId).order('id').range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<CteRow>>),
  ])

  const operacaoIds = operacoes.map((item) => item.id)
  const notaIds = notas.map((item) => item.id)
  const [operacaoNfs, entregas, cteNfs, postergacoes] = await Promise.all([
    operacaoIds.length ? consultarPorIds<OperacaoNfRow>(operacaoIds, 'Nao foi possivel consultar as notas das operacoes', (ids, inicio, fim) => supabase
      .from('operacoes_nfs').select('operacao_id, nota_fiscal_id').in('operacao_id', ids).order('operacao_id').order('nota_fiscal_id').range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<OperacaoNfRow>>) : [],
    operacaoIds.length ? consultarPorIds<EntregaRow>(operacaoIds, 'Nao foi possivel consultar as entregas das operacoes', (ids, inicio, fim) => supabase
      .from('nota_fiscal_entregas')
      .select('id, operacao_id, nota_fiscal_id, status_entrega, cessao_efetivada_em, data_limite_cte, data_limite_canhoto, updated_at')
      .in('operacao_id', ids).order('id').range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<EntregaRow>>) : [],
    ctes.length ? consultarPorIds<CteNfRow>(ctes.map((item) => item.id), 'Nao foi possivel consultar os vinculos CT-e x NF', (ids, inicio, fim) => supabase
      .from('cte_notas_fiscais').select('cte_id, nota_fiscal_id').in('cte_id', ids).order('cte_id').order('nota_fiscal_id').range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<CteNfRow>>) : [],
    notaIds.length ? consultarPorIds<PostergacaoRow>(notaIds, 'Nao foi possivel consultar as novas previsoes logisticas', (ids, inicio, fim) => supabase
      .from('nota_fiscal_entrega_postergacoes_canhoto')
      .select('nota_fiscal_id, prazo_original_upload_canhoto, nova_previsao_upload_canhoto, postergacao_comunicada_em')
      .in('nota_fiscal_id', ids).order('nota_fiscal_id').range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<PostergacaoRow>>) : [],
  ])
  const entregaIds = entregas.map((item) => item.id)
  const [requisitosNf, requisitosEntrega, canhotos] = await Promise.all([
    notaIds.length ? consultarPorIds<RequisitoRow>(notaIds, 'Nao foi possivel consultar os requisitos logisticos por NF', (ids, inicio, fim) => supabase
      .from('documento_requisito_instancias')
      .select('id, nota_fiscal_id, operacao_id, nota_fiscal_entrega_id, tipo_documento_codigo_snapshot, obrigatorio, documento_id, versao_aprovada_id, prazo_limite, status, updated_at')
      .in('nota_fiscal_id', ids).in('tipo_documento_codigo_snapshot', CODIGOS_LOGISTICOS).order('id').range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<RequisitoRow>>) : [],
    entregaIds.length ? consultarPorIds<RequisitoRow>(entregaIds, 'Nao foi possivel consultar os requisitos logisticos por entrega', (ids, inicio, fim) => supabase
      .from('documento_requisito_instancias')
      .select('id, nota_fiscal_id, operacao_id, nota_fiscal_entrega_id, tipo_documento_codigo_snapshot, obrigatorio, documento_id, versao_aprovada_id, prazo_limite, status, updated_at')
      .in('nota_fiscal_entrega_id', ids).in('tipo_documento_codigo_snapshot', CODIGOS_LOGISTICOS).order('id').range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<RequisitoRow>>) : [],
    entregaIds.length ? consultarPorIds<CanhotoRow>(entregaIds, 'Nao foi possivel consultar os comprovantes de entrega', (ids, inicio, fim) => supabase
      .from('canhotos')
      .select('id, nota_fiscal_entrega_id, documento_id, documento_versao_atual_id, documento_versao_aprovada_id, status, created_at, updated_at')
      .in('nota_fiscal_entrega_id', ids).order('id').range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<CanhotoRow>>) : [],
  ])
  const requisitos = [...new Map([...requisitosNf, ...requisitosEntrega].map((item) => [item.id, item])).values()]
  const documentoIds = [...new Set([
    ...requisitos.map((item) => item.documento_id), ...evidencias.map((item) => item.documento_id),
    ...ctes.map((item) => item.documento_id), ...canhotos.map((item) => item.documento_id),
  ].filter((item): item is string => Boolean(item)))]
  const versoes = documentoIds.length ? await consultarPorIds<VersaoRow>(documentoIds, 'Nao foi possivel consultar as versoes dos documentos logisticos', (ids, inicio, fim) => supabase
    .from('documento_versoes')
    .select('id, documento_id, numero_versao, nome_original, status, enviado_em')
    .in('documento_id', ids).order('documento_id').order('numero_versao').order('id').range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<VersaoRow>>) : []
  const analises = versoes.length ? await consultarPorIds<AnaliseRow>(versoes.map((item) => item.id), 'Nao foi possivel consultar as analises dos documentos logisticos', (ids, inicio, fim) => supabase
    .from('documento_analises')
    .select('id, documento_versao_id, resultado, analisado_em, analisado_por')
    .in('documento_versao_id', ids).order('documento_versao_id').order('analisado_em').order('id').range(inicio, fim) as unknown as PromiseLike<ResultadoConsulta<AnaliseRow>>) : []

  const versoesPorDocumento = agrupar(versoes.map((item): VersaoDocumentoCentralRaw => ({
    id: item.id, documentoId: item.documento_id, numero: item.numero_versao,
    nome: item.nome_original, status: item.status, enviadoEm: item.enviado_em,
  })), (item) => item.documentoId)
  const analisesPorVersao = agrupar(analises.map((item): AnaliseDocumentoCentralRaw => ({
    id: item.id, versaoId: item.documento_versao_id, resultado: item.resultado,
    analisadoEm: item.analisado_em, analisadoPor: item.analisado_por,
  })), (item) => item.versaoId)
  const operacoesPorId = new Map(operacoes.map((item) => [item.id, item]))
  const operacoesPorNf = agrupar(operacaoNfs, (item) => item.nota_fiscal_id)
  const entregasPorNf = agrupar(entregas, (item) => item.nota_fiscal_id)
  const entregasPorId = new Map(entregas.map((item) => [item.id, item]))
  const requisitosPorNf = agrupar(requisitos, (item) => item.nota_fiscal_id || entregasPorId.get(item.nota_fiscal_entrega_id || '')?.nota_fiscal_id)
  const evidenciasPorNf = agrupar(evidencias, (item) => item.nota_fiscal_id)
  const memoriasPorNf = agrupar(memorias, (item) => item.nota_fiscal_id)
  const cteNfsPorNf = agrupar(cteNfs, (item) => item.nota_fiscal_id)
  const ctesPorId = new Map(ctes.map((item) => [item.id, item]))
  const canhotosPorEntrega = agrupar(canhotos, (item) => item.nota_fiscal_entrega_id)
  const postergacaoPorNf = new Map(postergacoes.map((item) => [item.nota_fiscal_id, item]))

  const notasProjetadas: LogisticaNfResumo[] = []
  for (const nota of notas) {
    const operacao = (operacoesPorNf.get(nota.id) || [])
      .map((item) => operacoesPorId.get(item.operacao_id))
      .filter((item): item is OperacaoRow => Boolean(item))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
    const entrega = (entregasPorNf.get(nota.id) || []).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null
    const aplicabilidade = operacao ? resolverAplicabilidadeLogistica(operacao.politica_snapshot) : null
    const requisitosNota = requisitosPorNf.get(nota.id) || []
    const evidenciasNota = evidenciasPorNf.get(nota.id) || []
    const memoriasNota = memoriasPorNf.get(nota.id) || []
    const ctesNota = (cteNfsPorNf.get(nota.id) || []).map((item) => ctesPorId.get(item.cte_id)).filter((item): item is CteRow => Boolean(item))
    const canhotosNota = entrega ? canhotosPorEntrega.get(entrega.id) || [] : []
    const possuiContexto = Boolean(aplicabilidade?.habilitada || entrega || evidenciasNota.length || memoriasNota.length || ctesNota.length || canhotosNota.length || requisitosNota.length)
    if (!possuiContexto) continue

    const dataCessao = resolverDataCessaoConfiavel({
      cessaoEfetivadaEm: entrega?.cessao_efetivada_em || operacao?.cessao_efetivada_em || null,
      aprovadoEm: operacao?.aprovado_em || null,
      politicaSnapshot: operacao?.politica_snapshot,
    })
    const refs = new Map<FamiliaDocumentalLogistica, Array<{ documentoId: string | null; versaoAprovadaId: string | null; obrigatorio: boolean; prazoOriginal: string | null }>>([
      ['cte', []], ['comprovante_entrega', []],
    ])
    for (const requisito of requisitosNota) {
      const familia = resolverFamiliaDocumentalLogistica(requisito.tipo_documento_codigo_snapshot)
      if (familia) refs.get(familia)?.push({ documentoId: requisito.documento_id, versaoAprovadaId: requisito.versao_aprovada_id, obrigatorio: requisito.obrigatorio, prazoOriginal: requisito.prazo_limite })
    }
    for (const evidencia of evidenciasNota) refs.get(evidencia.familia_documental)?.push({ documentoId: evidencia.documento_id, versaoAprovadaId: null, obrigatorio: false, prazoOriginal: null })
    for (const cte of ctesNota) refs.get('cte')?.push({ documentoId: cte.documento_id, versaoAprovadaId: cte.documento_versao_aprovada_id, obrigatorio: aplicabilidade?.cte.obrigatorio ?? false, prazoOriginal: entrega?.data_limite_cte || null })
    for (const canhoto of canhotosNota) refs.get('comprovante_entrega')?.push({ documentoId: canhoto.documento_id, versaoAprovadaId: canhoto.documento_versao_aprovada_id, obrigatorio: aplicabilidade?.comprovanteEntrega.obrigatorio ?? false, prazoOriginal: entrega?.data_limite_canhoto || null })
    if (aplicabilidade?.cte.aplicavel && refs.get('cte')?.length === 0) refs.set('cte', [semDocumento('cte', aplicabilidade.cte.obrigatorio, entrega?.data_limite_cte || null, null)])
    if (aplicabilidade?.comprovanteEntrega.aplicavel && refs.get('comprovante_entrega')?.length === 0) refs.set('comprovante_entrega', [semDocumento('comprovante_entrega', aplicabilidade.comprovanteEntrega.obrigatorio, entrega?.data_limite_canhoto || null, null)])
    const postergacao = postergacaoPorNf.get(nota.id)
    const cte = projetarDocumentoLogistico(documentoPorFamilia({ familia: 'cte', refs: refs.get('cte') || [], novaPrevisao: null, versoesPorDocumento, analisesPorVersao }), dataCessao)
    const comprovante = projetarDocumentoLogistico(documentoPorFamilia({ familia: 'comprovante_entrega', refs: refs.get('comprovante_entrega') || [], novaPrevisao: postergacao?.nova_previsao_upload_canhoto || null, versoesPorDocumento, analisesPorVersao }), dataCessao)
    const atualizacoes = [nota.updated_at, entrega?.updated_at, cte.ultimoUploadEm, comprovante.ultimoUploadEm].filter(Boolean).sort()
    const base = {
      notaFiscalId: nota.id, numeroNf: nota.numero_nf, chaveAcesso: nota.chave_acesso,
      cedente: nota.razao_social_emitente, cedenteCnpj: nota.cnpj_emitente,
      sacado: nota.razao_social_destinatario, sacadoCnpj: nota.cnpj_destinatario,
      valor: Number(nota.valor_bruto || 0), emissao: nota.data_emissao, vencimento: nota.data_vencimento,
      operacao: operacao ? {
        id: operacao.id, status: operacao.status, criadaEm: operacao.created_at,
        aprovadaEm: operacao.aprovado_em, desembolsadaEm: operacao.cessao_efetivada_em, dataCessao,
      } : null,
      statusCriacao: statusHistorico(memoriasNota.map((item) => ({ etapa: item.etapa, status: item.status_logistico, createdAt: item.created_at })), 'criacao'),
      statusAprovacao: statusHistorico(memoriasNota.map((item) => ({ etapa: item.etapa, status: item.status_logistico, createdAt: item.created_at })), 'aprovacao'),
      gateObrigatorio: memoriasNota.some((item) => item.gate_exigido) || Boolean((operacao?.politica_snapshot as Record<string, unknown> | null)?.exigir_status_logistico_pre_cessao),
      cte,
      referenciasCte: ctesNota.flatMap((item) => [item.numero, item.chave_cte]).filter((item): item is string => Boolean(item)),
      comprovante, ultimaAtualizacao: atualizacoes.at(-1) || nota.updated_at,
    }
    notasProjetadas.push(complementarSituacaoNf(base))
  }

  const filtradas = ordenarNotasCentral(filtrarNotasCentral(notasProjetadas, filtros))
  const filtradasPorId = new Map(filtradas.map((item) => [item.notaFiscalId, item]))
  const idsFiltradas = new Set(filtradasPorId.keys())
  const resumo = resumirCentralLogistica(filtradas)
  const indicadores = indicadoresCentralLogistica(filtradas, postergacoes.filter((item) => idsFiltradas.has(item.nota_fiscal_id)).length)
  const cteItems = agregarCtesCentral(cteNfs.flatMap((relacao) => {
    const cteRow = ctesPorId.get(relacao.cte_id)
    const nota = filtradasPorId.get(relacao.nota_fiscal_id)
    if (!cteRow || !nota) return []
    const rawCte: DocumentoCentralRaw = {
      familia: 'cte', documentoId: cteRow.documento_id,
      versaoAprovadaId: cteRow.documento_versao_aprovada_id,
      obrigatorio: nota.cte.obrigatorio, prazoOriginal: nota.cte.prazoOriginal,
      novaPrevisao: null,
      versoes: cteRow.documento_id ? versoesPorDocumento.get(cteRow.documento_id) || [] : [],
      analises: cteRow.documento_id
        ? (versoesPorDocumento.get(cteRow.documento_id) || []).flatMap((versao) => analisesPorVersao.get(versao.id) || [])
        : [],
    }
    return [{
      cteId: cteRow.id, chave: cteRow.chave_cte, numero: cteRow.numero,
      cedente: nota.cedente, cedenteCnpj: nota.cedenteCnpj,
      documento: projetarDocumentoLogistico(rawCte, nota.operacao?.dataCessao || null), nota,
    }]
  }))
  const pendencias = filtradas.flatMap((nota) => nota.pendencias)
  const colecao: Array<LogisticaNfResumo | CteLogisticoResumo | (typeof pendencias)[number]> = filtros.tab === 'ctes' ? cteItems : filtros.tab === 'pendencias' ? pendencias : filtradas
  const total = colecao.length
  const totalPaginas = Math.max(1, Math.ceil(total / filtros.limite))
  const pagina = Math.min(filtros.pagina, totalPaginas)
  const inicio = (pagina - 1) * filtros.limite
  const itensPagina = opcoes.semPaginacao ? colecao : colecao.slice(inicio, inicio + filtros.limite)
  const idsPagina = new Set(itensPagina.map((item) => 'notaFiscalId' in item ? item.notaFiscalId : item.cteId))

  return {
    fundo: { id: fundo.fundoId, nome: fundo.fundoNome }, filtros,
    resumo, indicadores,
    notas: filtros.tab === 'ctes' || filtros.tab === 'pendencias' ? [] : filtradas.filter((item) => idsPagina.has(item.notaFiscalId)),
    pendencias: filtros.tab === 'pendencias' ? pendencias.filter((item) => idsPagina.has(item.notaFiscalId)) : [],
    ctes: filtros.tab === 'ctes' ? cteItems.filter((item) => idsPagina.has(item.cteId)) : [],
    paginacao: { pagina, limite: filtros.limite, total, totalPaginas },
    opcoes: {
      cedentes: [...new Map(notasProjetadas.map((item) => [item.cedenteCnpj, opcao(item.cedenteCnpj, item.cedente)])).values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
      sacados: [...new Map(notasProjetadas.map((item) => [item.sacadoCnpj, opcao(item.sacadoCnpj, item.sacado)])).values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
      operacoes: [...new Map(notasProjetadas.flatMap((item) => item.operacao ? [[item.operacao.id, opcao(item.operacao.id, `#${item.operacao.id.slice(0, 8)}`)] as const] : [])).values()],
    },
    totalUniverso: notasProjetadas.length,
  }
}
