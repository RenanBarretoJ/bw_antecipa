import 'server-only'

import {
  buildOffsetRange,
  buildPaginatedResult,
  buildPaginationMeta,
  type PaginatedResult,
  type SearchParamsRecord,
} from '@/lib/pagination'
import { assertRole, requireAuthenticated } from '@/lib/auth/authorization'
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
import { obterPoliticaAplicavelAoCedenteFundo } from './politica'
import { simularExposicaoSelecaoCanonica } from '@/lib/financeiro/risco/proforma-selecao.server'
import type { ProformaExposicaoSelecao } from '@/lib/financeiro/risco/visao-operacional'

export type ParcelaCandidataOperacao = {
  id: string
  numeroParcela: number
  valorNominal: number
  dataVencimento: string
}

type ParcelaCandidataRow = {
  id: string
  nota_fiscal_id: string
  numero_parcela: number
  valor_nominal: number
  data_vencimento: string
}

export type NfCandidataOperacao = NotaFiscalElegibilidadeComDados & {
  cnpjDestinatario: string
  destinatario: string
  vencimento: string
  elegibilidade: ElegibilidadeDocumental
  /** Parcelas disponiveis desta NF (vazio = NF sem parcelas, comportamento legado). */
  parcelas: ParcelaCandidataOperacao[]
}

export type ResultadoNovaSolicitacao = {
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
): Promise<ResultadoNovaSolicitacao> {
  const auth = await requireAuthenticated()
  assertRole(auth.profile.role, ['cedente'])
  const filtros = parseFiltrosNovaSolicitacao(searchParams)
  // get_user_cedente_id() resolve tanto o dono (cedentes.user_id) quanto um
  // usuario convidado via cedente_acessos -- filtrar so por user_id
  // quebrava esta pagina para todo usuario convidado.
  const { data: cedenteIdDoUsuario } = await auth.supabase.rpc('get_user_cedente_id')
  const { data: cedente, error: cedenteError } = cedenteIdDoUsuario
    ? await auth.supabase.from('cedentes').select('id, status').eq('id', cedenteIdDoUsuario).maybeSingle()
    : { data: null, error: null }
  if (cedenteError) throw new Error(`Nao foi possivel consultar o cedente: ${cedenteError.message}`)
  if (!cedente || cedente.status !== 'ativo') throw new Error('O cadastro do cedente precisa estar ativo.')

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
      .select('id, status, numero_nf, data_emissao, data_vencimento, cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto', { count: 'exact' })
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
  if (idsPagina.length > 0) {
    const { data: parcelasData, error: parcelasError } = await auth.supabase
      .from('nota_fiscal_parcelas')
      .select('id, nota_fiscal_id, numero_parcela, valor_nominal, data_vencimento')
      .in('nota_fiscal_id', idsPagina)
      .eq('status', 'disponivel')
      // Mesma regra ja aplicada a NF inteira (gte data_vencimento acima):
      // uma parcela com vencimento individual ja passado nao pode ser
      // antecipada (nao ha valor presente a calcular para uma data no
      // passado). Sem este filtro, uma NF cujo vencimento agregado (a
      // ultima parcela) ainda esta no futuro passava pela elegibilidade,
      // mas selecionar essa NF alimentava a parcela vencida no calculo,
      // que lanca CalculoFinanceiroError sem tratamento no render do
      // cliente e quebra a pagina inteira.
      .gte('data_vencimento', dataBase)
      .order('numero_parcela', { ascending: true })
    if (parcelasError) throw new Error(`Nao foi possivel carregar as parcelas das NFs candidatas: ${parcelasError.message}`)
    for (const parcela of (parcelasData || []) as ParcelaCandidataRow[]) {
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

  const candidatas = rows.map((row): NfCandidataOperacao => ({
    ...mapNota(row),
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
  }))
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
