import 'server-only'

import { cookies } from 'next/headers'
import { requireAuthenticated, assertRole, type AppSupabaseClient } from '@/lib/auth/authorization'
import { CEDENTE_FUNDO_ATIVO_COOKIE } from '@/lib/fundos/cedente-fundo-ativo'
import type { NfStatus, PoliticaNivelValidacao } from '@/lib/types/domain'
import { resolverEstadoChecklistDocumental } from '@/lib/documentos-v2/checklist-state'
import {
  avaliarElegibilidadeSubmissaoNfComDados,
  calcularIntervaloPagina,
  estadoSubmissaoPorStatus,
  normalizarCampoOrdenacaoListagemNf,
  normalizarLimiteListagemNf,
  resumoDocumentalDaAvaliacao,
  type CampoOrdenacaoListagemNf,
  type DirecaoOrdenacaoListagemNf,
  type NotaFiscalListagem,
  type RequisitoElegibilidadeComDados,
} from './listagem'

export type FiltrosListagemNotasFiscais = {
  pagina?: number
  limite?: number
  busca?: string
  status?: string
  ordenacao?: string
  direcao?: string
  valorMin?: number | null
  valorMax?: number | null
  emissaoDe?: string
  emissaoAte?: string
  vencimentoDe?: string
  vencimentoAte?: string
}

export type ResultadoListagemNotasFiscais = {
  itens: NotaFiscalListagem[]
  pagina: number
  limite: number
  total: number
  totalPaginas: number
  metricasPagina: {
    rascunhos: number
    aprovadas: number
    valor: number
  }
}

type ContextoCedenteFundo = {
  cedenteId: string
  cedenteFundoId: string
  fundoId: string
  fundoAtivo: boolean
}

type NotaFiscalRow = {
  id: string
  numero_nf: string
  serie: string | null
  chave_acesso: string | null
  cnpj_emitente: string
  razao_social_emitente: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  data_emissao: string
  data_vencimento: string
  status: NfStatus
}

type PoliticaPublicada = {
  versaoId: string
  requisitos: Array<{
    id: string
    tipo_documento_codigo: string
    escopo: string
    obrigatorio: boolean
    nivel_validacao: PoliticaNivelValidacao
    momento_obrigatorio: string | null
    bloqueia_fluxo: boolean
  }>
}

const NF_SELECT = `
  id,
  numero_nf,
  serie,
  chave_acesso,
  cnpj_emitente,
  razao_social_emitente,
  cnpj_destinatario,
  razao_social_destinatario,
  valor_bruto,
  data_emissao,
  data_vencimento,
  status
` as const

function normalizarPagina(value: number | undefined) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1
}

function normalizarDirecao(value: string | undefined): DirecaoOrdenacaoListagemNf {
  return value === 'asc' ? 'asc' : 'desc'
}

function normalizarStatus(value: string | undefined): NfStatus | null {
  const statuses = new Set<NfStatus>([
    'rascunho',
    'submetida',
    'em_analise',
    'aprovada',
    'em_antecipacao',
    'aceita',
    'contestada',
    'liquidada',
    'cancelada',
    'requer_ajuste',
  ])
  return value && statuses.has(value as NfStatus) ? value as NfStatus : null
}

function normalizarBusca(value: string | undefined) {
  return String(value || '')
    .trim()
    .slice(0, 120)
    .replace(/[,%().'"\\]/g, ' ')
    .replace(/\s+/g, ' ')
}

async function resolverContextoCedenteFundo(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<ContextoCedenteFundo> {
  const { data: cedente, error: cedenteError } = await supabase
    .from('cedentes')
    .select('id, status')
    .eq('user_id', userId)
    .maybeSingle()

  if (cedenteError) throw new Error(`Nao foi possivel consultar o cedente autenticado: ${cedenteError.message}`)
  if (!cedente) throw new Error('Cadastro de cedente nao encontrado.')
  if (cedente.status !== 'ativo') throw new Error('O cadastro do cedente nao esta ativo.')

  const { data: links, error: linksError } = await supabase
    .from('cedente_fundos')
    .select('id, cedente_id, fundo_id, status, vigente_desde')
    .eq('cedente_id', cedente.id)
    .eq('status', 'ativo')
    .order('vigente_desde', { ascending: false })

  if (linksError) throw new Error(`Nao foi possivel consultar o vinculo cedente-fundo: ${linksError.message}`)
  if (!links?.length) throw new Error('O cedente nao possui vinculo ativo com um fundo.')

  const selecionadoId = (await cookies()).get(CEDENTE_FUNDO_ATIVO_COOKIE)?.value
  const link = links.length === 1
    ? links[0]
    : links.find((item) => item.id === selecionadoId)
  if (!link) throw new Error('Selecione o fundo operacional antes de consultar as notas fiscais.')

  const { data: fundo, error: fundoError } = await supabase
    .from('fundos')
    .select('id, ativo')
    .eq('id', link.fundo_id)
    .maybeSingle()

  if (fundoError) throw new Error(`Nao foi possivel validar o fundo operacional: ${fundoError.message}`)
  if (!fundo) throw new Error('Fundo operacional nao encontrado.')
  if (fundo.ativo !== true) throw new Error('O fundo operacional esta inativo.')

  return {
    cedenteId: cedente.id,
    cedenteFundoId: link.id,
    fundoId: fundo.id,
    fundoAtivo: fundo.ativo === true,
  }
}

async function carregarPoliticaPublicada(
  supabase: AppSupabaseClient,
  contexto: ContextoCedenteFundo,
): Promise<PoliticaPublicada | null> {
  const now = new Date().toISOString()
  const { data: atribuicao, error: atribuicaoError } = await supabase
    .from('cedente_fundo_politicas')
    .select('politica_operacional_id')
    .eq('cedente_fundo_id', contexto.cedenteFundoId)
    .eq('status', 'ativa')
    .lte('vigente_desde', now)
    .or(`vigente_ate.is.null,vigente_ate.gt.${now}`)
    .order('vigente_desde', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (atribuicaoError) throw new Error(`Nao foi possivel consultar a politica atribuida: ${atribuicaoError.message}`)
  if (!atribuicao) return null

  const { data: politica, error: politicaError } = await supabase
    .from('politicas_operacionais')
    .select('id')
    .eq('id', atribuicao.politica_operacional_id)
    .eq('fundo_id', contexto.fundoId)
    .eq('status', 'ativa')
    .maybeSingle()
  if (politicaError) throw new Error(`Nao foi possivel validar a politica operacional: ${politicaError.message}`)
  if (!politica) return null

  const { data: versao, error: versaoError } = await supabase
    .from('politica_operacional_versoes')
    .select('id')
    .eq('politica_operacional_id', politica.id)
    .eq('fundo_id', contexto.fundoId)
    .eq('status', 'publicada')
    .not('publicada_em', 'is', null)
    .lte('vigente_desde', now)
    .or(`vigente_ate.is.null,vigente_ate.gt.${now}`)
    .order('versao', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (versaoError) throw new Error(`Nao foi possivel consultar a versao publicada da politica: ${versaoError.message}`)
  if (!versao) return null

  const { data: requisitos, error: requisitosError } = await supabase
    .from('politica_requisitos_documentais')
    .select('id, tipo_documento_codigo, escopo, obrigatorio, nivel_validacao, momento_obrigatorio, bloqueia_fluxo')
    .eq('politica_operacional_versao_id', versao.id)
    .eq('ativo', true)
    .eq('escopo', 'nf_pre_cessao')
    .order('ordem', { ascending: true })
  if (requisitosError) throw new Error(`Nao foi possivel consultar os requisitos da politica: ${requisitosError.message}`)

  return {
    versaoId: versao.id,
    requisitos: (requisitos || []) as PoliticaPublicada['requisitos'],
  }
}

function requisitoVazio(
  notaFiscalId: string,
  requisito: PoliticaPublicada['requisitos'][number],
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

export async function carregarNotasFiscaisComResumoDocumental(
  filtros: FiltrosListagemNotasFiscais,
): Promise<ResultadoListagemNotasFiscais> {
  const auth = await requireAuthenticated()
  assertRole(auth.profile.role, ['cedente'])
  if (auth.profile.status !== 'ativo') throw new Error('O perfil do usuario nao esta ativo.')

  const contexto = await resolverContextoCedenteFundo(auth.supabase, auth.user.id)
  const pagina = normalizarPagina(filtros.pagina)
  const limite = normalizarLimiteListagemNf(Number(filtros.limite))
  const ordenacao = normalizarCampoOrdenacaoListagemNf(String(filtros.ordenacao || ''))
  const direcao = normalizarDirecao(filtros.direcao)
  const { inicio, fim } = calcularIntervaloPagina(pagina, limite)
  const status = normalizarStatus(filtros.status)
  const busca = normalizarBusca(filtros.busca)

  let query = auth.supabase
    .from('notas_fiscais')
    .select(NF_SELECT, { count: 'exact' })
    .eq('cedente_id', contexto.cedenteId)
    .eq('cedente_fundo_id', contexto.cedenteFundoId)
    .eq('fundo_id', contexto.fundoId)

  if (status) query = query.eq('status', status)
  if (busca) {
    const digitosBusca = busca.replace(/\D/g, '')
    const condicoesBusca = [
      `numero_nf.ilike.%${busca}%`,
      `razao_social_destinatario.ilike.%${busca}%`,
    ]
    if (digitosBusca) condicoesBusca.push(`cnpj_destinatario.ilike.%${digitosBusca}%`)
    query = query.or(condicoesBusca.join(','))
  }
  if (Number.isFinite(filtros.valorMin)) query = query.gte('valor_bruto', Number(filtros.valorMin))
  if (Number.isFinite(filtros.valorMax)) query = query.lte('valor_bruto', Number(filtros.valorMax))
  if (filtros.emissaoDe) query = query.gte('data_emissao', filtros.emissaoDe)
  if (filtros.emissaoAte) query = query.lte('data_emissao', filtros.emissaoAte)
  if (filtros.vencimentoDe) query = query.gte('data_vencimento', filtros.vencimentoDe)
  if (filtros.vencimentoAte) query = query.lte('data_vencimento', filtros.vencimentoAte)

  const { data, error, count } = await query
    .order(ordenacao as CampoOrdenacaoListagemNf, { ascending: direcao === 'asc' })
    .order('id', { ascending: direcao === 'asc' })
    .range(inicio, fim)

  if (error) throw new Error(`Nao foi possivel carregar as notas fiscais: ${error.message}`)

  const rows = (data || []) as NotaFiscalRow[]
  const idsPagina = rows.map((row) => row.id)
  const rascunhos = rows.filter((row) => row.status === 'rascunho')
  const idsRascunho = rascunhos.map((row) => row.id)

  const entregaPorNf = new Map<string, string>()
  if (idsPagina.length > 0) {
    const { data: entregas, error: entregasError } = await auth.supabase
      .from('nota_fiscal_entregas')
      .select('nota_fiscal_id, status_entrega, created_at')
      .in('nota_fiscal_id', idsPagina)
      .neq('status_entrega', 'nao_aplicavel')
      .order('created_at', { ascending: false })
    if (entregasError) throw new Error(`Nao foi possivel carregar o estado logistico: ${entregasError.message}`)
    for (const entrega of entregas || []) {
      if (!entregaPorNf.has(entrega.nota_fiscal_id)) {
        entregaPorNf.set(entrega.nota_fiscal_id, entrega.status_entrega)
      }
    }
  }

  const resumoPorNf = new Map<string, ReturnType<typeof resumoDocumentalDaAvaliacao>>()
  if (idsRascunho.length > 0) {
    const politica = await carregarPoliticaPublicada(auth.supabase, contexto)
    const { data: instancias, error: instanciasError } = politica
      ? await auth.supabase
        .from('documento_requisito_instancias')
        .select('id, nota_fiscal_id, politica_requisito_id, tipo_documento_codigo_snapshot, escopo_snapshot, obrigatorio, status, documento_id, versao_aprovada_id, nivel_validacao_snapshot')
        .in('nota_fiscal_id', idsRascunho)
        .eq('politica_operacional_versao_id', politica.versaoId)
        .eq('escopo_snapshot', 'nf_pre_cessao')
      : { data: [], error: null }
    if (instanciasError) throw new Error(`Nao foi possivel carregar os requisitos documentais em lote: ${instanciasError.message}`)

    const instanciaRows = (instancias || []) as Array<{
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
    const documentoIds = Array.from(new Set(instanciaRows.map((row) => row.documento_id).filter(Boolean) as string[]))
    const { data: versoes, error: versoesError } = documentoIds.length
      ? await auth.supabase
        .from('documento_versoes')
        .select('id, documento_id, numero_versao, status')
        .in('documento_id', documentoIds)
        .in('status', ['enviado', 'em_analise', 'aprovado', 'rejeitado'])
        .order('numero_versao', { ascending: false })
      : { data: [], error: null }
    if (versoesError) throw new Error(`Nao foi possivel carregar as versoes documentais em lote: ${versoesError.message}`)

    const versaoAtualPorDocumento = new Map<string, { id: string; status: string; ultimaAnalise: { resultado: string } | null }>()
    for (const versao of versoes || []) {
      if (!versaoAtualPorDocumento.has(versao.documento_id)) {
        versaoAtualPorDocumento.set(versao.documento_id, {
          id: versao.id,
          status: versao.status,
          ultimaAnalise: null,
        })
      }
    }
    const versaoAtualIds = Array.from(versaoAtualPorDocumento.values()).map((versao) => versao.id)
    const { data: analises, error: analisesError } = versaoAtualIds.length
      ? await auth.supabase
        .from('documento_analises')
        .select('documento_versao_id, resultado, analisado_em')
        .in('documento_versao_id', versaoAtualIds)
        .order('analisado_em', { ascending: false })
      : { data: [], error: null }
    if (analisesError) throw new Error(`Nao foi possivel carregar o estado de analise documental: ${analisesError.message}`)

    const ultimaAnalisePorVersao = new Map<string, { resultado: string }>()
    for (const analise of analises || []) {
      if (!ultimaAnalisePorVersao.has(analise.documento_versao_id)) {
        ultimaAnalisePorVersao.set(analise.documento_versao_id, { resultado: analise.resultado })
      }
    }
    for (const versao of versaoAtualPorDocumento.values()) {
      versao.ultimaAnalise = ultimaAnalisePorVersao.get(versao.id) || null
    }

    const { data: linksOperacoes, error: linksError } = await auth.supabase
      .from('operacoes_nfs')
      .select('nota_fiscal_id, operacao_id')
      .in('nota_fiscal_id', idsRascunho)
    if (linksError) throw new Error(`Nao foi possivel validar os vinculos operacionais: ${linksError.message}`)
    const operacaoIds = Array.from(new Set((linksOperacoes || []).map((row) => row.operacao_id)))
    const { data: operacoes, error: operacoesError } = operacaoIds.length
      ? await auth.supabase.from('operacoes').select('id, status').in('id', operacaoIds)
      : { data: [], error: null }
    if (operacoesError) throw new Error(`Nao foi possivel validar o estado das operacoes: ${operacoesError.message}`)
    const statusOperacao = new Map((operacoes || []).map((row) => [row.id, row.status]))
    const nfComOperacaoIncompativel = new Set(
      (linksOperacoes || [])
        .filter((row) => {
          const status = statusOperacao.get(row.operacao_id)
          return status && !['cancelada', 'reprovada'].includes(status)
        })
        .map((row) => row.nota_fiscal_id),
    )

    const instanciaPorNfERequisito = new Map(
      instanciaRows.map((row) => [`${row.nota_fiscal_id}:${row.politica_requisito_id}`, row]),
    )
    for (const nf of rascunhos) {
      const requisitos = (politica?.requisitos || []).map((requisito) => {
        const instancia = instanciaPorNfERequisito.get(`${nf.id}:${requisito.id}`)
        if (!instancia) return requisitoVazio(nf.id, requisito)
        return {
          id: requisito.id,
          notaFiscalId: nf.id,
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
        } satisfies RequisitoElegibilidadeComDados
      })
      const estadoChecklist = resolverEstadoChecklistDocumental({
        politicaSnapshot: Boolean(politica),
        requisitosAplicaveis: (politica?.requisitos || []).map((requisito) => ({
          id: requisito.id,
          codigo: requisito.tipo_documento_codigo,
          tipoDocumentoCodigo: requisito.tipo_documento_codigo,
          escopo: requisito.escopo,
          obrigatorio: requisito.obrigatorio,
          ativo: true,
        })),
        instancias: instanciaRows
          .filter((instancia) => instancia.nota_fiscal_id === nf.id)
          .map((instancia) => {
            const versaoAtual = instancia.documento_id
              ? versaoAtualPorDocumento.get(instancia.documento_id) || null
              : null
            return {
              requisitoId: instancia.politica_requisito_id,
              codigo: instancia.tipo_documento_codigo_snapshot,
              obrigatorio: instancia.obrigatorio,
              status: instancia.status,
              documentoId: instancia.documento_id,
              versaoAprovadaId: instancia.versao_aprovada_id,
              nivelValidacao: instancia.nivel_validacao_snapshot,
              versoes: versaoAtual ? [versaoAtual] : [],
            }
          }),
      })
      const todosInstanciados = !['sem_politica', 'nao_instanciado', 'erro'].includes(estadoChecklist.estado)
      const avaliacao = avaliarElegibilidadeSubmissaoNfComDados({
        notaFiscal: {
          id: nf.id,
          status: nf.status,
          numero: nf.numero_nf,
          dataEmissao: nf.data_emissao,
          dataVencimento: nf.data_vencimento,
          cnpjEmitente: nf.cnpj_emitente,
          razaoSocialEmitente: nf.razao_social_emitente,
          cnpjDestinatario: nf.cnpj_destinatario,
          razaoSocialDestinatario: nf.razao_social_destinatario,
          valorBruto: nf.valor_bruto,
        },
        requisitos,
        contexto: {
          cedenteFundoAtivo: true,
          fundoAtivo: contexto.fundoAtivo,
          politicaPublicadaVigente: Boolean(politica),
          requisitosInstanciados: todosInstanciados,
          operacaoIncompativel: nfComOperacaoIncompativel.has(nf.id),
        },
      })
      resumoPorNf.set(nf.id, resumoDocumentalDaAvaliacao(avaliacao))
    }
  }

  const itens = rows.map((row): NotaFiscalListagem => {
    const resumoDocumental = resumoPorNf.get(row.id)
    return {
      id: row.id,
      numero: row.numero_nf,
      serie: row.serie,
      destinatario: row.razao_social_destinatario,
      cnpjDestinatario: row.cnpj_destinatario,
      valorBruto: row.valor_bruto,
      emissao: row.data_emissao,
      vencimento: row.data_vencimento,
      status: row.status,
      entregaStatus: entregaPorNf.get(row.id) || null,
      estadoSubmissao: estadoSubmissaoPorStatus(row.status, resumoDocumental?.elegivel),
      ...(resumoDocumental ? { resumoDocumental } : {}),
    }
  })
  const total = count || 0

  return {
    itens,
    pagina,
    limite,
    total,
    totalPaginas: Math.max(1, Math.ceil(total / limite)),
    metricasPagina: {
      rascunhos: rows.filter((row) => row.status === 'rascunho').length,
      aprovadas: rows.filter((row) => row.status === 'aprovada').length,
      valor: rows.reduce((sum, row) => sum + Number(row.valor_bruto || 0), 0),
    },
  }
}
