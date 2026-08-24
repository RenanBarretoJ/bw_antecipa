import Decimal from 'decimal.js'

export const HOMOLOG_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
export const QA_PL_PROVIDER = 'qa_synthetic_pl'
export const QA_PL_ORIGIN = 'GOLDEN_DATASET'
export const QA_PL_VERSION = 'QA_SYNTHETIC_PL_V1'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const INACTIVE_IMPORT_STATUSES = new Set(['FALHA', 'CANCELADA'])

export type PlSinteticoInput = {
  fundoId: string
  pl: string
  dataBase: string
  replaceQa: boolean
}

export type FundoPlSintetico = {
  id: string
  nome: string
  cnpj: string | null
  ativo: boolean
}

export type ImportacaoPlExistente = {
  id: string
  provedor: string
  origem: string
  status: string
  patrimonioLiquido: string | null
}

export type BaseFinanceira = {
  tipoBase: 'ESTOQUE' | 'AQUISICOES' | 'LIQUIDACOES'
  dataReferencia: string
  completude: string
  linhasPublicadas: number
}

export type ConfirmacaoPl = {
  importacaoId: string
  fundoId: string
  dataReferencia: string
  patrimonioLiquido: string
  provedor: string
  origem: string
  status: string
  vigente: boolean
}

export type BootstrapFinanceiro = {
  fundoVirgem: boolean
  carteiraOficial: {
    importacaoId: string
    dataReferencia: string
    patrimonioLiquido: string
  } | null
}

export interface RepositorioPlSintetico {
  obterFundo(fundoId: string): Promise<FundoPlSintetico | null>
  listarImportacoesNaData(fundoId: string, dataBase: string): Promise<ImportacaoPlExistente[]>
  listarBasesFinanceiras(fundoId: string): Promise<BaseFinanceira[]>
  confirmarPl(importacaoId: string): Promise<ConfirmacaoPl | null>
  resolverBootstrap(fundoId: string): Promise<BootstrapFinanceiro>
}

export interface PipelinePlSintetico {
  ingerir(input: {
    fundoId: string
    dataBase: string
    arquivo: Uint8Array
    nomeArquivo: string
  }): Promise<{ importacaoId: string; status: string; duplicada: boolean }>
  publicar(importacaoId: string): Promise<unknown>
}

export type ResultadoPublicacaoPl = {
  fundo: FundoPlSintetico
  confirmacao: ConfirmacaoPl
  bootstrap: BootstrapFinanceiro
  bases: BaseFinanceira[]
  substituiuQa: boolean
  idempotente: boolean
}

function projectRefFromApiUrl(rawUrl: string) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) return null
  return url.hostname.match(/^([a-z0-9]+)[.]supabase[.]co$/i)?.[1] ?? null
}

function projectRefFromDbUrl(rawUrl: string) {
  const url = new URL(rawUrl)
  const pooler = decodeURIComponent(url.username).match(/^postgres[.]([a-z0-9]+)$/i)
  if (pooler) return pooler[1]
  return url.hostname.match(/^db[.]([a-z0-9]+)[.]supabase[.]co$/i)?.[1] ?? null
}

export function validarAlvoExclusivoHomolog(env: Record<string, string | undefined>) {
  const apiUrls = [env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_URL].filter((value): value is string => Boolean(value))
  const dbUrls = [env.SUPABASE_DB_URL, env.DATABASE_URL].filter((value): value is string => Boolean(value))
  if (!apiUrls.length || !dbUrls.length || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('ERRO: este script so pode executar em homologacao; credenciais obrigatorias ausentes.')
  }

  let apiRefs: Array<string | null>
  let dbRefs: Array<string | null>
  try {
    apiRefs = apiUrls.map(projectRefFromApiUrl)
    dbRefs = dbUrls.map(projectRefFromDbUrl)
  } catch {
    throw new Error('ERRO: este script so pode executar em homologacao; URL Supabase invalida.')
  }

  if ([...apiRefs, ...dbRefs].some((ref) => ref !== HOMOLOG_PROJECT_REF)) {
    throw new Error('ERRO: este script so pode executar em homologacao.')
  }
  if (env.SUPABASE_PRODUCTION_PROJECT_REF === HOMOLOG_PROJECT_REF) {
    throw new Error('ERRO: referencia de homologacao conflita com a referencia de producao.')
  }
  return HOMOLOG_PROJECT_REF
}

export function validarEntradaPlSintetico(raw: Partial<PlSinteticoInput>): PlSinteticoInput {
  const fundoId = String(raw.fundoId || '').trim()
  const dataBase = String(raw.dataBase || '').trim()
  const plRaw = String(raw.pl || '').trim()
  if (!UUID_PATTERN.test(fundoId)) throw new Error('Informe --fundo-id com um UUID valido.')
  if (!DATE_PATTERN.test(dataBase) || new Date(`${dataBase}T00:00:00.000Z`).toISOString().slice(0, 10) !== dataBase) {
    throw new Error('Informe --data-base como uma data valida em YYYY-MM-DD.')
  }
  if (!/^\d+(?:[.,]\d{1,4})?$/.test(plRaw)) throw new Error('Informe --pl como numero positivo com ate quatro casas decimais.')
  const pl = new Decimal(plRaw.replace(',', '.'))
  if (!pl.isFinite() || pl.lte(0) || pl.greaterThan('9999999999999999.9999')) {
    throw new Error('O PL deve ser maior que zero e caber no limite financeiro suportado.')
  }
  return { fundoId, dataBase, pl: pl.toFixed(4), replaceQa: raw.replaceQa === true }
}

export function importacaoEhQaSintetica(importacao: ImportacaoPlExistente) {
  return importacao.provedor === QA_PL_PROVIDER && importacao.origem === QA_PL_ORIGIN
}

export function decidirPublicacaoPl(importacoes: ImportacaoPlExistente[], replaceQa: boolean) {
  const relevantes = importacoes.filter((item) => !INACTIVE_IMPORT_STATUSES.has(item.status))
  const oficiais = relevantes.filter((item) => !importacaoEhQaSintetica(item))
  if (oficiais.length) {
    throw new Error('Ja existe Carteira real/oficial para este fundo e data-base. Nenhum dado foi alterado.')
  }
  const qa = relevantes.filter(importacaoEhQaSintetica)
  if (qa.length && !replaceQa) {
    throw new Error('Ja existe PL sintetico QA para este fundo e data-base. Use --replace-qa para retificar somente o QA.')
  }
  return { substituirQa: qa.length > 0, importacoesQa: qa }
}

function csv(value: string | null) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

export function construirCarteiraQaCsv(input: PlSinteticoInput, fundo: FundoPlSintetico, publicadoEm = new Date().toISOString()) {
  const cabecalho = ['FUNDO_EXTERNO', 'DOC_FUNDO', 'FUNDO_ID', 'DATA_REFERENCIA', 'VERSAO', 'PATRIMONIO_LIQUIDO', 'PUBLICADA_EM']
  const linha = [fundo.nome, fundo.cnpj?.replace(/\D/g, '') || '', fundo.id, input.dataBase, QA_PL_VERSION, input.pl, publicadoEm]
  return `${cabecalho.map(csv).join(';')}\n${linha.map(csv).join(';')}\n`
}

function mesmoValor(left: string | null, right: string) {
  return left !== null && new Decimal(left).equals(new Decimal(right))
}

export async function executarPublicacaoPlSintetico(
  input: PlSinteticoInput,
  dependencies: { repositorio: RepositorioPlSintetico; pipeline: PipelinePlSintetico; agora?: () => string },
): Promise<ResultadoPublicacaoPl> {
  const fundo = await dependencies.repositorio.obterFundo(input.fundoId)
  if (!fundo) throw new Error('Fundo nao encontrado. Nenhum dado foi alterado.')
  if (!fundo.ativo) throw new Error('O fundo informado esta inativo. Nenhum dado foi alterado.')

  const importacoesAntes = await dependencies.repositorio.listarImportacoesNaData(input.fundoId, input.dataBase)
  const decisao = decidirPublicacaoPl(importacoesAntes, input.replaceQa)
  const qaPublicadaIgual = decisao.importacoesQa.find((item) => item.status === 'PUBLICADA' && mesmoValor(item.patrimonioLiquido, input.pl))

  let importacaoId: string
  let idempotente = false
  if (qaPublicadaIgual) {
    importacaoId = qaPublicadaIgual.id
    idempotente = true
  } else {
    // Segunda leitura imediatamente antes da primeira escrita reduz a janela
    // operacional e impede que uma Carteira oficial observada no preflight
    // seja retificada pelo fluxo QA.
    decidirPublicacaoPl(await dependencies.repositorio.listarImportacoesNaData(input.fundoId, input.dataBase), input.replaceQa)
    const arquivo = new TextEncoder().encode(construirCarteiraQaCsv(input, fundo, dependencies.agora?.()))
    const ingestao = await dependencies.pipeline.ingerir({
      fundoId: input.fundoId,
      dataBase: input.dataBase,
      arquivo,
      nomeArquivo: `QA_SYNTHETIC_PL_${input.dataBase}.csv`,
    })
    if (ingestao.status === 'FALHA') throw new Error('A validacao canonica da Carteira sintetica falhou; o PL nao foi publicado.')
    if (ingestao.duplicada && ingestao.status === 'PUBLICADA') idempotente = true
    else {
      if (ingestao.status !== 'VALIDA') throw new Error(`A ingestao terminou com status ${ingestao.status}; o PL nao foi publicado.`)
      await dependencies.pipeline.publicar(ingestao.importacaoId)
    }
    importacaoId = ingestao.importacaoId
  }

  const confirmacao = await dependencies.repositorio.confirmarPl(importacaoId)
  if (!confirmacao || confirmacao.status !== 'PUBLICADA' || !confirmacao.vigente) {
    throw new Error('A leitura canonica nao confirmou um snapshot de PL publicado e vigente.')
  }
  if (confirmacao.provedor !== QA_PL_PROVIDER || confirmacao.origem !== QA_PL_ORIGIN || confirmacao.fundoId !== input.fundoId || confirmacao.dataReferencia !== input.dataBase || !mesmoValor(confirmacao.patrimonioLiquido, input.pl)) {
    throw new Error('A leitura canonica retornou PL ou linhagem divergente da solicitacao.')
  }

  const [bootstrap, bases] = await Promise.all([
    dependencies.repositorio.resolverBootstrap(input.fundoId),
    dependencies.repositorio.listarBasesFinanceiras(input.fundoId),
  ])
  return { fundo, confirmacao, bootstrap, bases, substituiuQa: decisao.substituirQa && !idempotente, idempotente }
}
