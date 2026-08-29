import 'server-only'

import { requireGestor } from '@/lib/auth/authorization'
import { obterFundoAtivoAutorizado } from '@/lib/fundos/fundo-ativo.server'
import { createClient } from '@/lib/supabase/server'
import {
  CODIGOS_COMPROVANTE_ENTREGA,
  CODIGOS_CTE_LOGISTICO,
  construirLinhaAcompanhamentoLogistico,
  filtrarLinhasAcompanhamentoLogistico,
  ordenarLinhasAcompanhamentoLogistico,
  paginarAcompanhamentoLogistico,
  resolverAplicabilidadeLogistica,
  resolverAplicabilidadeLogisticaDosRequisitos,
  resolverEstadoInicialAcompanhamentoLogistico,
  resumirAcompanhamentoLogistico,
  type DocumentoLogisticoCompactoRaw,
  type FiltroAcompanhamentoLogistico,
  type LinhaAcompanhamentoLogistico,
  type ResumoAcompanhamentoLogistico,
} from './acompanhamento-operacao'

const PAGE_SIZE = 10
const INITIAL_SIZE = 5
const FILTROS_VALIDOS = new Set<FiltroAcompanhamentoLogistico>(['todos', 'atencao', 'pendentes', 'em_analise', 'concluidos'])
const CODIGOS_LOGISTICOS = [...CODIGOS_CTE_LOGISTICO, ...CODIGOS_COMPROVANTE_ENTREGA]

export interface AcompanhamentoLogisticoQuery {
  expandido?: boolean
  pagina?: number
  filtro?: FiltroAcompanhamentoLogistico
  busca?: string
}

export type AcompanhamentoLogisticoOperacaoData =
  | { estado: 'oculto' }
  | {
    estado: 'aguardando_desembolso'
    totalNotas: number
  }
  | {
    estado: 'pronto'
    resumo: ResumoAcompanhamentoLogistico
    linhas: LinhaAcompanhamentoLogistico[]
    totalFiltrado: number
    pagina: number
    totalPaginas: number
    expandido: boolean
    filtro: FiltroAcompanhamentoLogistico
    busca: string
    possuiMais: boolean
    exibeCte: boolean
    exibeComprovante: boolean
  }

type OperacaoRow = {
  id: string
  cedente_fundo_id: string | null
  status: string
  cessao_efetivada_em: string | null
  politica_snapshot: unknown | null
}

type OperacaoNfRow = {
  nota_fiscal_id: string
  notas_fiscais: { id: string; numero_nf: string; data_vencimento: string | null } | null
}

type EntregaRow = {
  id: string
  nota_fiscal_id: string
  status_entrega: string
  data_limite_cte: string | null
  data_limite_canhoto: string | null
  entrega_confirmada_em: string | null
  motivo_pendencia: string | null
}

type RequisitoRow = {
  nota_fiscal_entrega_id: string | null
  tipo_documento_codigo_snapshot: string
  obrigatorio: boolean
  status: string
  prazo_limite: string | null
  documento_id: string | null
  updated_at: string | null
}

type DocumentoRow = { id: string; status: string; updated_at: string }
type PostergacaoRow = {
  nota_fiscal_id: string
  prazo_original_upload_canhoto: string
  nova_previsao_upload_canhoto: string
  postergacao_comunicada_em: string
}

function normalizarQuery(query: AcompanhamentoLogisticoQuery) {
  const filtro = query.filtro && FILTROS_VALIDOS.has(query.filtro) ? query.filtro : 'todos'
  return {
    expandido: query.expandido === true,
    pagina: Number.isInteger(query.pagina) && Number(query.pagina) > 0 ? Number(query.pagina) : 1,
    filtro,
    busca: String(query.busca || '').trim().slice(0, 40),
  }
}

function falharConsulta(contexto: string, error: { message: string } | null) {
  if (error) throw new Error(`${contexto}: ${error.message}`)
}

export async function carregarAcompanhamentoLogisticoOperacao(
  operacaoId: string,
  query: AcompanhamentoLogisticoQuery = {},
): Promise<AcompanhamentoLogisticoOperacaoData> {
  const supabase = await createClient()
  const [{ user }, fundoAtivo] = await Promise.all([
    requireGestor(supabase),
    obterFundoAtivoAutorizado(),
  ])
  const fundoId = fundoAtivo.fundoId
  if (!fundoId) throw new Error('Nenhum fundo ativo autorizado encontrado.')

  const { data: operacaoData, error: operacaoError } = await supabase
    .from('operacoes')
    .select('id, cedente_fundo_id, status, cessao_efetivada_em, politica_snapshot')
    .eq('id', operacaoId)
    .maybeSingle()
  falharConsulta('Nao foi possivel consultar a operacao', operacaoError)
  const operacao = operacaoData as OperacaoRow | null
  if (!operacao?.cedente_fundo_id) throw new Error('Operacao sem vinculo cedente-fundo valido.')

  const [{ data: vinculoData, error: vinculoError }, { data: autorizacaoData, error: autorizacaoError }] = await Promise.all([
    supabase
      .from('cedente_fundos')
      .select('id, fundo_id')
      .eq('id', operacao.cedente_fundo_id)
      .eq('fundo_id', fundoId)
      .maybeSingle(),
    supabase
      .from('usuario_fundos')
      .select('fundo_id')
      .eq('usuario_id', user.id)
      .eq('fundo_id', fundoId)
      .eq('status', 'ativo')
      .maybeSingle(),
  ])
  falharConsulta('Nao foi possivel validar o vinculo da operacao', vinculoError)
  falharConsulta('Nao foi possivel validar a autorizacao do fundo', autorizacaoError)
  if (!vinculoData || !autorizacaoData) throw new Error('Operacao fora do fundo autorizado para o gestor.')

  const { data: operacaoNfsData, error: operacaoNfsError } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id, notas_fiscais!inner(id, numero_nf, data_vencimento)')
    .eq('operacao_id', operacaoId)
    .order('nota_fiscal_id')
  falharConsulta('Nao foi possivel consultar as notas da operacao', operacaoNfsError)
  const notas = (operacaoNfsData || []) as unknown as OperacaoNfRow[]
  const aplicabilidadeSnapshot = resolverAplicabilidadeLogistica(operacao.politica_snapshot)
  const desembolsada = Boolean(operacao.cessao_efetivada_em)
    || ['em_andamento', 'liquidada', 'inadimplente'].includes(operacao.status)
  const estadoInicial = resolverEstadoInicialAcompanhamentoLogistico({
    aplicavel: aplicabilidadeSnapshot.habilitada,
    desembolsada,
  })
  if (estadoInicial === 'oculto') return { estado: 'oculto' }
  if (estadoInicial === 'aguardando_desembolso') return { estado: 'aguardando_desembolso', totalNotas: notas.length }

  const { data: entregasData, error: entregasError } = await supabase
    .from('nota_fiscal_entregas')
    .select('id, nota_fiscal_id, status_entrega, data_limite_cte, data_limite_canhoto, entrega_confirmada_em, motivo_pendencia')
    .eq('operacao_id', operacaoId)
    .not('status_entrega', 'in', '(nao_aplicavel,cancelada)')
  falharConsulta('Nao foi possivel consultar as entregas da operacao', entregasError)
  const entregas = (entregasData || []) as EntregaRow[]
  const entregaIds = entregas.map((entrega) => entrega.id)
  const notaIds = notas.map((nota) => nota.nota_fiscal_id)

  const [requisitosResult, postergacoesResult] = await Promise.all([
    entregaIds.length
      ? supabase
        .from('documento_requisito_instancias')
        .select('nota_fiscal_entrega_id, tipo_documento_codigo_snapshot, obrigatorio, status, prazo_limite, documento_id, updated_at')
        .in('nota_fiscal_entrega_id', entregaIds)
        .in('tipo_documento_codigo_snapshot', CODIGOS_LOGISTICOS)
        .not('status', 'in', '(cancelado,dispensado)')
      : Promise.resolve({ data: [], error: null }),
    notaIds.length
      ? supabase
        .from('nota_fiscal_entrega_postergacoes_canhoto')
        .select('nota_fiscal_id, prazo_original_upload_canhoto, nova_previsao_upload_canhoto, postergacao_comunicada_em')
        .in('nota_fiscal_id', notaIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  falharConsulta('Nao foi possivel consultar os requisitos logisticos', requisitosResult.error)
  falharConsulta('Nao foi possivel consultar as novas previsoes de entrega', postergacoesResult.error)
  const requisitos = (requisitosResult.data || []) as RequisitoRow[]
  const documentoIds = Array.from(new Set(requisitos.map((item) => item.documento_id).filter(Boolean))) as string[]
  const { data: documentosData, error: documentosError } = documentoIds.length
    ? await supabase.from('documentos_repositorio').select('id, status, updated_at').in('id', documentoIds)
    : { data: [], error: null }
  falharConsulta('Nao foi possivel consultar o estado dos documentos logisticos', documentosError)

  const documentos = new Map(((documentosData || []) as DocumentoRow[]).map((documento) => [documento.id, documento]))
  const entregasPorNf = new Map(entregas.map((entrega) => [entrega.nota_fiscal_id, entrega]))
  const requisitosPorEntrega = new Map<string, RequisitoRow[]>()
  for (const requisito of requisitos) {
    if (!requisito.nota_fiscal_entrega_id) continue
    const atuais = requisitosPorEntrega.get(requisito.nota_fiscal_entrega_id) || []
    atuais.push(requisito)
    requisitosPorEntrega.set(requisito.nota_fiscal_entrega_id, atuais)
  }
  const postergacoesPorNf = new Map(((postergacoesResult.data || []) as PostergacaoRow[]).map((item) => [item.nota_fiscal_id, item]))

  const linhas = notas.flatMap((nota) => {
    const entrega = entregasPorNf.get(nota.nota_fiscal_id) || null
    const requisitosDaEntrega = entrega ? requisitosPorEntrega.get(entrega.id) || [] : []
    const documentosCompactos: DocumentoLogisticoCompactoRaw[] = requisitosDaEntrega.map((requisito) => {
      const documento = requisito.documento_id ? documentos.get(requisito.documento_id) : null
      return {
        codigo: requisito.tipo_documento_codigo_snapshot,
        obrigatorio: requisito.obrigatorio,
        statusInstancia: requisito.status,
        statusDocumento: documento?.status || null,
        prazoLimite: requisito.prazo_limite,
        atualizadoEm: documento?.updated_at || requisito.updated_at,
      }
    })
    const postergacao = postergacoesPorNf.get(nota.nota_fiscal_id) || null
    const aplicabilidadeNf = entrega
      ? resolverAplicabilidadeLogisticaDosRequisitos(documentosCompactos)
      : aplicabilidadeSnapshot
    if (!aplicabilidadeNf.habilitada) return []
    return [construirLinhaAcompanhamentoLogistico({
      notaFiscalId: nota.nota_fiscal_id,
      numeroNf: nota.notas_fiscais?.numero_nf || nota.nota_fiscal_id.slice(0, 8),
      vencimentoNf: nota.notas_fiscais?.data_vencimento || null,
      entrega: entrega ? {
        id: entrega.id,
        status: entrega.status_entrega,
        dataLimiteCte: entrega.data_limite_cte,
        dataLimiteComprovante: entrega.data_limite_canhoto,
        entregaConfirmadaEm: entrega.entrega_confirmada_em,
        motivoPendencia: entrega.motivo_pendencia,
      } : null,
      documentos: documentosCompactos,
      postergacao: postergacao ? {
        prazoOriginal: postergacao.prazo_original_upload_canhoto,
        novaPrevisao: postergacao.nova_previsao_upload_canhoto,
        comunicadaEm: postergacao.postergacao_comunicada_em,
      } : null,
      aplicabilidade: aplicabilidadeNf,
    })]
  })

  if (linhas.length === 0) return { estado: 'oculto' }

  const resumo = resumirAcompanhamentoLogistico(linhas)
  const params = normalizarQuery(query)
  const filtradas = ordenarLinhasAcompanhamentoLogistico(
    filtrarLinhasAcompanhamentoLogistico(linhas, params.filtro, params.busca),
  )
  const paginacao = paginarAcompanhamentoLogistico(filtradas, {
    expandido: params.expandido,
    pagina: params.pagina,
    tamanhoInicial: INITIAL_SIZE,
    tamanhoPagina: PAGE_SIZE,
  })

  return {
    estado: 'pronto',
    resumo,
    linhas: paginacao.linhas,
    totalFiltrado: filtradas.length,
    pagina: paginacao.pagina,
    totalPaginas: paginacao.totalPaginas,
    expandido: params.expandido,
    filtro: params.filtro,
    busca: params.busca,
    possuiMais: linhas.length > INITIAL_SIZE,
    exibeCte: linhas.some((linha) => linha.cte.aplicavel),
    exibeComprovante: linhas.some((linha) => linha.comprovanteEntrega.aplicavel),
  }
}
