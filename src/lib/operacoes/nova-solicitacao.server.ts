import 'server-only'

import {
  buildOffsetRange,
  buildPaginatedResult,
  buildPaginationMeta,
  type PaginatedResult,
  type SearchParamsRecord,
} from '@/lib/pagination'
import { requireAuthenticated } from '@/lib/auth/authorization'
import { resolverCedenteFundoAtivo } from '@/lib/fundos/cedente-fundo'
import type { NotaFiscalElegibilidadeComDados } from '@/lib/notas-fiscais/listagem'
import type { ElegibilidadeDocumental } from '@/lib/actions/documento-v2'
import { carregarElegibilidadeDocumentalOperacaoEmLote } from './elegibilidade-documental.server'
import {
  parseFiltrosNovaSolicitacao,
  type FiltrosNovaSolicitacao,
} from './nova-solicitacao'
import { obterDataCivilOperacional } from './data-operacional.server'
import type { MetodoCalculoNovaPolitica } from './calculo'
import { resolverBaseAntecipacao, type BaseValorAntecipacao } from './base-antecipacao'
import { obterPoliticaAplicavelAoCedenteFundo } from './politica'
import { simularExposicaoSelecaoCanonica } from '@/lib/financeiro/risco/proforma-selecao.server'
import type { ProformaExposicaoSelecao } from '@/lib/financeiro/risco/visao-operacional'
import {
  resolverCedenteSolicitanteOperacao,
  type PerfilSolicitanteOperacao,
} from './solicitante.server'

export type ParcelaCandidataOperacao = {
  id: string
  numeroParcela: number
  valorNominal: number
  dataVencimento: string
}

type ParcelaCandidataRow = {
  status: string
  id: string
  nota_fiscal_id: string
  numero_parcela: number
  valor_nominal: number
  data_vencimento: string
}

export type NfCandidataOperacao = NotaFiscalElegibilidadeComDados & {
  valorBaseAntecipacao: number | null
  valorLiquidoFiscal: number | null
  cnpjDestinatario: string
  destinatario: string
  vencimento: string
  elegibilidade: ElegibilidadeDocumental
  /** Parcelas disponiveis desta NF (vazio = NF sem parcelas, comportamento legado). */
  parcelas: ParcelaCandidataOperacao[]
}

export type ResultadoNovaSolicitacao = {
  baseValorAntecipacao: BaseValorAntecipacao
  perfil: PerfilSolicitanteOperacao
  cedente: {
    id: string
    cnpj: string
    razaoSocial: string
    nomeFantasia: string | null
  }
  candidatas: PaginatedResult<NfCandidataOperacao>
  taxas: Array<{ prazo_min: number; prazo_max: number; taxa_percentual: number }>
  filtros: FiltrosNovaSolicitacao
  dataBase: string
  metodoCalculo: MetodoCalculoNovaPolitica | null
  proformaExposicao: ProformaExposicaoSelecao | null
}

type NfRow = {
  id: string
  status: string
  numero_nf: string
  data_emissao: string
  data_vencimento: string
  cnpj_emitente: string
  razao_social_emitente: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  valor_liquido: number | null
  valor_liquido_origem: string | null
}

function mapNota(row: NfRow): NotaFiscalElegibilidadeComDados {
  return {
    id: row.id,
    status: row.status,
    numero: row.numero_nf,
    dataEmissao: row.data_emissao,
    dataVencimento: row.data_vencimento,
    cnpjEmitente: row.cnpj_emitente,
    razaoSocialEmitente: row.razao_social_emitente,
    cnpjDestinatario: row.cnpj_destinatario,
    razaoSocialDestinatario: row.razao_social_destinatario,
    valorBruto: Number(row.valor_bruto || 0),
  }
}

function buscaPostgrestSegura(value: string) {
  return value.replace(/[,%().'"\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function carregarNovaSolicitacaoOperacao(
  searchParams: SearchParamsRecord,
  options: { cedenteId?: string | null } = {},
): Promise<ResultadoNovaSolicitacao> {
  const auth = await requireAuthenticated()
  const filtros = parseFiltrosNovaSolicitacao(searchParams)
  const solicitante = await resolverCedenteSolicitanteOperacao(auth, options.cedenteId)
  const cedente = solicitante.cedente

  const contexto = await resolverCedenteFundoAtivo(cedente.id, auth.supabase)
  if (!contexto.cedenteFundo || !contexto.fundo) throw new Error('O cedente nao possui fundo operacional ativo.')
  const politica = await obterPoliticaAplicavelAoCedenteFundo({
    cedenteId: cedente.id,
    cedenteFundoId: contexto.cedenteFundo.id,
    fundoId: contexto.fundo.id,
  }, auth.supabase)
  const dataBase = obterDataCivilOperacional()
  const paginaSolicitada = filtros.page
  const limite = filtros.pageSize
  let { from, to } = buildOffsetRange({ page: paginaSolicitada, pageSize: limite })

  const consultar = (inicio: number, fim: number) => {
    let query = auth.supabase
      .from('notas_fiscais')
      .select('id, status, numero_nf, data_emissao, data_vencimento, cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, valor_liquido, valor_liquido_origem', { count: 'exact' })
      .eq('cedente_id', cedente.id)
      .eq('cedente_fundo_id', contexto.cedenteFundo!.id)
      .eq('fundo_id', contexto.fundo!.id)
      .eq('status', 'aprovada')
      .gte('data_vencimento', dataBase)
    const busca = buscaPostgrestSegura(filtros.q)
    if (busca) {
      const digitos = busca.replace(/\D/g, '')
      query = query.or([
        `numero_nf.ilike.%${busca}%`,
        `razao_social_destinatario.ilike.%${busca}%`,
        digitos ? `cnpj_destinatario.ilike.%${digitos}%` : '',
      ].filter(Boolean).join(','))
    }
    return query
      .order(filtros.sort, { ascending: filtros.direction === 'asc' })
      .order('id', { ascending: filtros.direction === 'asc' })
      .range(inicio, fim)
  }

  let resultado = await consultar(from, to)
  if (resultado.error) throw new Error(`Nao foi possivel carregar as NFs candidatas: ${resultado.error.message}`)
  const total = resultado.count || 0
  const meta = buildPaginationMeta({
    page: paginaSolicitada,
    pageSize: limite,
    total,
    currentItemCount: resultado.data?.length || 0,
  })
  if (meta.wasPageAdjusted && total > 0) {
    ;({ from, to } = buildOffsetRange({ page: meta.page, pageSize: limite }))
    resultado = await consultar(from, to)
    if (resultado.error) throw new Error(`Nao foi possivel ajustar a pagina de NFs: ${resultado.error.message}`)
  }

  const rows = (resultado.data || []) as NfRow[]
  const notas = rows.map(mapNota)
  const elegibilidades = await carregarElegibilidadeDocumentalOperacaoEmLote({
    client: auth.supabase,
    notas,
    politicaVersaoId: politica.versao.id,
  })

  const idsPagina = rows.map((row) => row.id)
  const parcelasPorNf = new Map<string, ParcelaCandidataOperacao[]>()
  const nfsComParcelas = new Set<string>()
  if (idsPagina.length > 0) {
    const { data: parcelasData, error: parcelasError } = await auth.supabase
      .from('nota_fiscal_parcelas')
      .select('id, nota_fiscal_id, numero_parcela, valor_nominal, data_vencimento, status')
      .in('nota_fiscal_id', idsPagina)
      // Lemos todas para identificar parcelamento (LIQUIDO nao o admite).
      // O filtro abaixo exclui parcelas vencidas/indisponiveis antes de
      // envia-las ao calculo, preservando a protecao contra prazo passado.
      .order('numero_parcela', { ascending: true })
    if (parcelasError) throw new Error(`Nao foi possivel carregar as parcelas das NFs candidatas: ${parcelasError.message}`)
    for (const parcela of (parcelasData || []) as ParcelaCandidataRow[]) {
      // LIQUIDO denies any installment, including unavailable/expired installments.
      nfsComParcelas.add(parcela.nota_fiscal_id)
      if (parcela.status !== 'disponivel' || parcela.data_vencimento < dataBase) continue
      const lista = parcelasPorNf.get(parcela.nota_fiscal_id) || []
      lista.push({
        id: parcela.id,
        numeroParcela: parcela.numero_parcela,
        valorNominal: Number(parcela.valor_nominal),
        dataVencimento: parcela.data_vencimento,
      })
      parcelasPorNf.set(parcela.nota_fiscal_id, lista)
    }
  }

  const candidatas = rows.map((row): NfCandidataOperacao => {
    const base = resolverBaseAntecipacao(politica.cedenteFundo.base_valor_antecipacao, {
      valorBruto: Number(row.valor_bruto),
      valorLiquido: row.valor_liquido == null ? null : Number(row.valor_liquido),
      origemLiquido: row.valor_liquido_origem,
      possuiParcelas: nfsComParcelas.has(row.id),
    })
    const candidata: NfCandidataOperacao = {
      ...mapNota(row),
      valorBaseAntecipacao: base.elegivel ? base.valorBase : null,
      valorLiquidoFiscal: row.valor_liquido == null ? null : Number(row.valor_liquido),
      cnpjDestinatario: row.cnpj_destinatario,
      destinatario: row.razao_social_destinatario,
      vencimento: row.data_vencimento,
      parcelas: parcelasPorNf.get(row.id) || [],
      elegibilidade: elegibilidades.get(row.id) || {
        elegivel: false,
        requisitosPendentes: [],
        requisitosRejeitados: [],
        requisitosEmAnalise: [],
        motivos: ['Nao foi possivel determinar a elegibilidade documental.'],
        totalObrigatorios: 0,
        concluidosObrigatorios: 0,
        pendentesObrigatorios: 0,
      },
    }
    if (!base.elegivel) candidata.elegibilidade = {
      ...candidata.elegibilidade, elegivel: false,
      motivos: [...candidata.elegibilidade.motivos, base.motivo],
    }
    return candidata
  })
  const { data: taxas, error: taxasError } = await auth.supabase
    .from('taxas_cedente')
    .select('prazo_min, prazo_max, taxa_percentual')
    .eq('cedente_id', cedente.id)
    .order('prazo_min', { ascending: true })
  if (taxasError) throw new Error(`Nao foi possivel carregar as taxas: ${taxasError.message}`)

  const proformaExposicao = await simularExposicaoSelecaoCanonica({
    client: auth.supabase,
    cedenteId: cedente.id,
    cedenteFundoId: contexto.cedenteFundo.id,
    fundoId: contexto.fundo.id,
    fundoNome: contexto.fundo.nome,
    politica,
    notaFiscalIds: [],
    parcelaIds: [],
  })

  return {
    baseValorAntecipacao: politica.cedenteFundo.base_valor_antecipacao,
    perfil: solicitante.perfil,
    cedente: {
      id: cedente.id,
      cnpj: cedente.cnpj,
      razaoSocial: cedente.razao_social,
      nomeFantasia: cedente.nome_fantasia,
    },
    candidatas: buildPaginatedResult(candidatas, {
      page: meta.page,
      pageSize: limite,
      total,
    }),
    taxas: (taxas || []).map((item) => ({
      prazo_min: Number(item.prazo_min),
      prazo_max: Number(item.prazo_max),
      taxa_percentual: Number(item.taxa_percentual),
    })),
    filtros,
    dataBase,
    metodoCalculo: politica.versao.metodo_calculo_financeiro,
    proformaExposicao,
  }
}
