import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import Decimal from 'decimal.js'
import { createAdminClient } from '@/lib/supabase/server'
import {
  chavesPropagaveis,
  executarMatchDeterministico,
  identidadeExternaDaFonte,
} from '../matching/matching'
import { avaliarCompletudeBases, reconciliarTitulosD2D1 } from './reconciliation'
import { resolverBootstrapFinanceiro } from '@/lib/financeiro/bootstrap/detector.server'
import {
  MATCH_RULE_VERSION,
  RECONCILIATION_RULE_VERSION,
  type FinancialExternalSource,
  type KnownCrosswalk,
  type NoteCandidate,
  type ReconciliationRow,
} from './types'

type ImportRow = {
  id: string
  fundo_id: string
  provedor: string
  tipo_base: 'ESTOQUE' | 'AQUISICOES' | 'LIQUIDACOES'
  data_referencia: string
  status: string
  completude: string
  publicada_em: string | null
  substitui_importacao_id?: string | null
}

type CanonicalRow = Record<string, unknown> & { id: string; fundo_id: string; provedor: string }

export type FinancialPipelineReadCache = {
  imports: Map<string, Promise<ImportRow | null>>
  canonicalRows: Map<string, Promise<CanonicalRow[]>>
}

export function createFinancialPipelineReadCache(): FinancialPipelineReadCache {
  return { imports: new Map(), canonicalRows: new Map() }
}

const admin = () => createAdminClient() as ReturnType<typeof createAdminClient> & {
  from: (table: string) => ReturnType<ReturnType<typeof createAdminClient>['from']>
}

function sha256(parts: unknown) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

function previousDate(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function text(value: unknown) {
  return value === null || value === undefined ? null : String(value)
}

function externalSource(row: CanonicalRow, origin: FinancialExternalSource['origem']): FinancialExternalSource {
  const acquisition = origin === 'AQUISICAO'
  const liquidation = origin === 'LIQUIDACAO'
  return {
    id: row.id,
    fundoId: row.fundo_id,
    provedor: row.provedor,
    origem: origin,
    externalTitleKey: text(row.id_recebivel),
    idRecebivel: text(row.id_recebivel),
    seuNumero: text(row.seu_numero),
    chaveNfe: liquidation ? null : text(row.chave_nfe),
    numeroDocumento: text(row.numero_documento),
    cedenteDocumento: text(row.cedente_documento),
    cedenteNome: text(row.cedente_nome),
    sacadoDocumento: text(row.sacado_documento),
    sacadoNome: text(row.sacado_nome),
    dataVencimento: text(row.data_vencimento_original ?? row.data_vencimento),
    valorReferencia: text(
      acquisition ? row.valor_compra : liquidation ? row.valor_aquisicao ?? row.valor_pago : row.valor_aquisicao ?? row.valor_nominal,
    ),
    tipoRecebivel: text(row.tipo_recebivel),
  }
}

async function latestImport(fundoId: string, type: ImportRow['tipo_base'], date: string, cache?: FinancialPipelineReadCache) {
  const cacheKey = `${fundoId}:${type}:${date}`
  const cached = cache?.imports.get(cacheKey)
  if (cached) return cached
  const request = (async () => {
    const { data, error } = await admin()
      .from('importacoes_financeiras')
      .select('id,fundo_id,provedor,tipo_base,data_referencia,status,completude,publicada_em,substitui_importacao_id')
      .eq('fundo_id', fundoId)
      .eq('tipo_base', type)
      .eq('data_referencia', date)
      .eq('status', 'PUBLICADA')
      .order('publicada_em', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`Nao foi possivel resolver a base ${type}: ${error.message}`)
    return data as ImportRow | null
  })()
  cache?.imports.set(cacheKey, request)
  try {
    return await request
  } catch (error) {
    cache?.imports.delete(cacheKey)
    throw error
  }
}

async function canonicalRows(type: ImportRow['tipo_base'], importId: string, cache?: FinancialPipelineReadCache): Promise<CanonicalRow[]> {
  const table = type === 'ESTOQUE'
    ? 'estoque_posicoes'
    : type === 'AQUISICOES'
      ? 'aquisicao_movimentos'
      : 'liquidacao_movimentos'
  const cacheKey = `${type}:${importId}`
  const cached = cache?.canonicalRows.get(cacheKey)
  if (cached) return cached
  const request = (async () => {
    const { data, error } = await admin().from(table).select('*').eq('importacao_id', importId).order('id')
    if (error) throw new Error(`Nao foi possivel carregar ${type}: ${error.message}`)
    return (data || []) as CanonicalRow[]
  })()
  cache?.canonicalRows.set(cacheKey, request)
  try {
    return await request
  } catch (error) {
    cache?.canonicalRows.delete(cacheKey)
    throw error
  }
}

async function notesForFund(fundoId: string): Promise<NoteCandidate[]> {
  const { data, error } = await admin()
    .from('notas_fiscais')
    .select('id,fundo_id,numero_nf,chave_acesso,cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,data_vencimento,valor_bruto')
    .eq('fundo_id', fundoId)
  if (error) throw new Error(`Nao foi possivel carregar as NFs do fundo: ${error.message}`)
  return (data || []).map((row: Record<string, unknown>) => ({
    id: String(row.id), fundoId: String(row.fundo_id), numero: String(row.numero_nf),
    chaveAcesso: text(row.chave_acesso), cedenteDocumento: String(row.cnpj_emitente || ''),
    cedenteNome: String(row.razao_social_emitente || ''), sacadoDocumento: String(row.cnpj_destinatario || ''),
    sacadoNome: String(row.razao_social_destinatario || ''), dataVencimento: String(row.data_vencimento || ''),
    valorBruto: String(row.valor_bruto || '0'),
  }))
}

async function crosswalkForFund(fundoId: string): Promise<KnownCrosswalk[]> {
  const { data: links, error: linksError } = await admin()
    .from('titulo_nf_vinculos')
    .select('id,fundo_id,provedor,nota_fiscal_id,origem')
    .eq('fundo_id', fundoId)
    .eq('status', 'ATIVO')
  if (linksError) throw new Error(`Nao foi possivel carregar o crosswalk: ${linksError.message}`)
  const linkIds = (links || []).map((item: Record<string, unknown>) => String(item.id))
  if (linkIds.length === 0) return []
  const { data: keys, error: keysError } = await admin()
    .from('titulo_nf_vinculo_chaves')
    .select('vinculo_id,fundo_id,provedor,tipo_chave,valor_normalizado')
    .in('vinculo_id', linkIds)
  if (keysError) throw new Error(`Nao foi possivel carregar as chaves do crosswalk: ${keysError.message}`)
  const byId = new Map((links || []).map((item: Record<string, unknown>) => [String(item.id), item]))
  return (keys || []).map((key: Record<string, unknown>) => {
    const link = byId.get(String(key.vinculo_id))!
    return {
      vinculoId: String(key.vinculo_id), fundoId: String(key.fundo_id), provedor: String(key.provedor),
      notaFiscalId: String(link.nota_fiscal_id), origem: String(link.origem) as KnownCrosswalk['origem'],
      tipoChave: String(key.tipo_chave) as KnownCrosswalk['tipoChave'], valorNormalizado: String(key.valor_normalizado),
    }
  })
}

export async function executarMatchingFinanceiro(input: { fundoId: string; dataReferencia: string; atorUsuarioId: string; readCache?: FinancialPipelineReadCache }) {
  const imports = (await Promise.all([
    latestImport(input.fundoId, 'ESTOQUE', input.dataReferencia, input.readCache),
    latestImport(input.fundoId, 'AQUISICOES', input.dataReferencia, input.readCache),
    latestImport(input.fundoId, 'LIQUIDACOES', input.dataReferencia, input.readCache),
  ])).filter(Boolean) as ImportRow[]
  if (imports.length === 0) {
    const bootstrap = await resolverBootstrapFinanceiro(admin(), input.fundoId)
    if (!bootstrap.fundoVirgem) throw new Error('Nenhuma base financeira publicada foi encontrada para a data informada.')
    const correlationId = randomUUID()
    const signature = sha256({ fundoId: input.fundoId, date: input.dataReferencia, inputIds: [], rule: MATCH_RULE_VERSION, bootstrap: true })
    const payload = {
      fundo_id: input.fundoId, data_referencia: input.dataReferencia, regra_versao: MATCH_RULE_VERSION,
      input_import_ids: [], assinatura_execucao: signature, correlation_id: correlationId,
      criado_por: input.atorUsuarioId, bootstrap: true, resultados: [],
    }
    const { data, error } = await admin().rpc('persistir_matching_execucao', { p_payload: payload })
    if (error) throw new Error(`Nao foi possivel persistir o matching de bootstrap: ${error.message}`)
    return { execucaoId: String(data), total: 0, signature, correlationId, bootstrap: true as const }
  }

  const [notes, initialCrosswalk, rowGroups] = await Promise.all([
    notesForFund(input.fundoId), crosswalkForFund(input.fundoId),
    Promise.all(imports.map((item) => canonicalRows(item.tipo_base, item.id, input.readCache))),
  ])
  const sources = imports.flatMap((item, index) => rowGroups[index].map((row) => externalSource(
    row, item.tipo_base === 'ESTOQUE' ? 'ESTOQUE' : item.tipo_base === 'AQUISICOES' ? 'AQUISICAO' : 'LIQUIDACAO',
  )))
  const localCrosswalk = [...initialCrosswalk]
  const results = sources.map((source) => {
    const result = executarMatchDeterministico(source, notes, localCrosswalk)
    if (result.status === 'MATCH_FORTE' && result.notaFiscalId) {
      const syntheticLink = result.vinculoId || `pending:${source.id}`
      for (const key of chavesPropagaveis(source)) {
        localCrosswalk.push({
          vinculoId: syntheticLink, fundoId: source.fundoId, provedor: source.provedor,
          notaFiscalId: result.notaFiscalId, origem: 'AUTOMATICO', tipoChave: key.tipo, valorNormalizado: key.valor,
        })
      }
    }
    return result
  })
  const inputIds = imports.map((item) => item.id).sort()
  const correlationId = randomUUID()
  const signature = sha256({ fundoId: input.fundoId, date: input.dataReferencia, inputIds, rule: MATCH_RULE_VERSION })
  const payload = {
    fundo_id: input.fundoId, data_referencia: input.dataReferencia, regra_versao: MATCH_RULE_VERSION,
    input_import_ids: inputIds, assinatura_execucao: signature, correlation_id: correlationId, criado_por: input.atorUsuarioId,
    resultados: results.map((result) => ({
      provedor: result.source.provedor, origem_registro: result.source.origem,
      origem_registro_id: result.source.id, identidade_externa: identidadeExternaDaFonte(result.source),
      id_recebivel: result.source.idRecebivel, seu_numero: result.source.seuNumero,
      chave_nfe: result.source.chaveNfe, numero_documento: result.source.numeroDocumento,
      cedente_documento: result.source.cedenteDocumento, cedente_nome: result.source.cedenteNome,
      sacado_documento: result.source.sacadoDocumento, sacado_nome: result.source.sacadoNome,
      data_vencimento: result.source.dataVencimento, valor_referencia: result.source.valorReferencia,
      tipo_recebivel: result.source.tipoRecebivel, status: result.status, metodo: result.metodo,
      nota_fiscal_id: result.notaFiscalId, evidencias: result.evidencias,
      chaves: chavesPropagaveis(result.source),
      candidatos: result.candidates.map((candidate, index) => ({
        nota_fiscal_id: candidate.notaFiscalId, ordem: index + 1, metodo: candidate.metodo, evidencias: candidate.evidencias,
      })),
    })),
  }
  const { data, error } = await admin().rpc('persistir_matching_execucao', { p_payload: payload })
  if (error) throw new Error(`Nao foi possivel persistir o matching: ${error.message}`)
  return { execucaoId: String(data), total: results.length, signature, correlationId }
}

function identity(row: CanonicalRow) {
  return text(row.id_recebivel) || text(row.seu_numero) || text(row.chave_nfe)
}

function reconRow(row: CanonicalRow, movement: 'ESTOQUE' | 'AQUISICAO' | 'LIQUIDACAO', links: Map<string, KnownCrosswalk>): ReconciliationRow {
  const external = identity(row)
  const link = external ? links.get(`${row.provedor}:ID_RECEBIVEL:${external}`) : undefined
  return {
    identidadeExterna: external, fundoId: row.fundo_id, provedor: row.provedor,
    valorAquisicao: text(row.valor_aquisicao ?? row.valor_compra),
    valorMovimento: movement === 'AQUISICAO' ? text(row.valor_compra) : movement === 'LIQUIDACAO' ? text(row.valor_pago) : null,
    tipoMovimento: movement === 'LIQUIDACAO' ? text(row.tipo_movimento) : null,
    statusRecebivel: movement === 'LIQUIDACAO' ? text(row.status_recebivel) : null,
    notaFiscalId: link?.notaFiscalId || null, vinculoId: link?.vinculoId || null,
  }
}

function comparableRow(row: CanonicalRow, type: ImportRow['tipo_base']) {
  return JSON.stringify(type === 'ESTOQUE'
    ? [text(row.valor_aquisicao), text(row.valor_nominal), text(row.situacao_recebivel)]
    : [text(row.valor_compra), text(row.valor_vencimento), text(row.codigo_movimento)])
}

async function retifiedIdentities(current: ImportRow | null, type: 'ESTOQUE' | 'AQUISICOES', cache?: FinancialPipelineReadCache) {
  if (!current?.substitui_importacao_id) return new Set<string>()
  const [before, after] = await Promise.all([
    canonicalRows(type, current.substitui_importacao_id, cache),
    canonicalRows(type, current.id, cache),
  ])
  const beforeByIdentity = new Map(before.map((row) => [identity(row), comparableRow(row, type)]))
  const afterByIdentity = new Map(after.map((row) => [identity(row), comparableRow(row, type)]))
  const identities = new Set([...beforeByIdentity.keys(), ...afterByIdentity.keys()].filter(Boolean) as string[])
  return new Set([...identities].filter((key) => beforeByIdentity.get(key) !== afterByIdentity.get(key)))
}

export async function executarConciliacaoFinanceira(input: { fundoId: string; dataReferencia: string; atorUsuarioId: string; readCache?: FinancialPipelineReadCache }) {
  const d2Date = previousDate(input.dataReferencia)
  const [stockD2, stockD1, acquisitionsD1, liquidationsD1] = await Promise.all([
    latestImport(input.fundoId, 'ESTOQUE', d2Date, input.readCache), latestImport(input.fundoId, 'ESTOQUE', input.dataReferencia, input.readCache),
    latestImport(input.fundoId, 'AQUISICOES', input.dataReferencia, input.readCache), latestImport(input.fundoId, 'LIQUIDACOES', input.dataReferencia, input.readCache),
  ])
  const imports = [stockD2, stockD1, acquisitionsD1, liquidationsD1]
  const missing = avaliarCompletudeBases([
    { nome: 'ESTOQUE_D2', existe: Boolean(stockD2), completude: stockD2?.completude || null },
    { nome: 'ESTOQUE_D1', existe: Boolean(stockD1), completude: stockD1?.completude || null },
    { nome: 'AQUISICOES_D1', existe: Boolean(acquisitionsD1), completude: acquisitionsD1?.completude || null },
    { nome: 'LIQUIDACOES_D1', existe: Boolean(liquidationsD1), completude: liquidationsD1?.completude || null },
  ])
  const inputIds = imports.filter(Boolean).map((item) => item!.id).sort()
  const matching = await admin().from('matching_execucoes').select('id')
    .eq('fundo_id', input.fundoId).eq('data_referencia', input.dataReferencia).eq('status', 'CONCLUIDA')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (matching.error) throw new Error(`Nao foi possivel resolver a execucao de matching: ${matching.error.message}`)
  const correlationId = randomUUID()
  const signature = sha256({ fundoId: input.fundoId, date: input.dataReferencia, inputIds, matching: matching.data?.id || null, rule: RECONCILIATION_RULE_VERSION })

  if (missing.length === 4) {
    const bootstrap = await resolverBootstrapFinanceiro(admin(), input.fundoId)
    if (bootstrap.fundoVirgem) {
      const bootstrapSignature = sha256({ fundoId: input.fundoId, date: input.dataReferencia, inputIds: [], matching: matching.data?.id || null, rule: RECONCILIATION_RULE_VERSION, bootstrap: true })
      const payload = {
        fundo_id: input.fundoId, data_referencia: input.dataReferencia, regra_versao: RECONCILIATION_RULE_VERSION,
        input_import_ids: [], assinatura_execucao: bootstrapSignature, correlation_id: correlationId,
        criado_por: input.atorUsuarioId, matching_execucao_id: matching.data?.id || null, bootstrap: true,
        status: 'CONCLUIDA', detalhes: { bootstrap: true }, contagens: {}, valores_agregados: {}, resultados: [],
      }
      const { data, error } = await admin().rpc('persistir_conciliacao_execucao', { p_payload: payload })
      if (error) throw new Error(`Nao foi possivel persistir a conciliacao de bootstrap: ${error.message}`)
      return { execucaoId: String(data), status: 'CONCLUIDA' as const, total: 0, signature: bootstrapSignature, correlationId, bootstrap: true as const }
    }
  }

  if (missing.length > 0) {
    const payload = {
      fundo_id: input.fundoId, data_referencia: input.dataReferencia, regra_versao: RECONCILIATION_RULE_VERSION,
      input_import_ids: inputIds, assinatura_execucao: signature, correlation_id: correlationId,
      criado_por: input.atorUsuarioId, matching_execucao_id: matching.data?.id || null,
      estoque_d2_importacao_id: stockD2?.id || null, estoque_d1_importacao_id: stockD1?.id || null,
      aquisicoes_d1_importacao_id: acquisitionsD1?.id || null, liquidacoes_d1_importacao_id: liquidationsD1?.id || null,
      status: 'BASE_INCOMPLETA', detalhes: { bases_ausentes_ou_incompletas: missing },
      contagens: { BASE_INCOMPLETA: 1 }, valores_agregados: {}, resultados: [],
    }
    const { data, error } = await admin().rpc('persistir_conciliacao_execucao', { p_payload: payload })
    if (error) throw new Error(`Nao foi possivel persistir a base incompleta: ${error.message}`)
    return { execucaoId: String(data), status: 'BASE_INCOMPLETA' as const, missing, signature, correlationId }
  }

  const [rowsD2, rowsD1, rowsAcq, rowsLiq, crosswalk, stockRetifications, acquisitionRetifications] = await Promise.all([
    canonicalRows('ESTOQUE', stockD2!.id, input.readCache), canonicalRows('ESTOQUE', stockD1!.id, input.readCache),
    canonicalRows('AQUISICOES', acquisitionsD1!.id, input.readCache), canonicalRows('LIQUIDACOES', liquidationsD1!.id, input.readCache),
    crosswalkForFund(input.fundoId),
    retifiedIdentities(stockD1, 'ESTOQUE', input.readCache),
    retifiedIdentities(acquisitionsD1, 'AQUISICOES', input.readCache),
  ])
  const links = new Map(crosswalk.map((item) => [`${item.provedor}:${item.tipoChave}:${item.valorNormalizado}`, item]))
  const results = reconciliarTitulosD2D1({
    fundoId: input.fundoId,
    estoqueD2: rowsD2.map((row) => reconRow(row, 'ESTOQUE', links)),
    estoqueD1: rowsD1.map((row) => reconRow(row, 'ESTOQUE', links)),
    aquisicoesD1: rowsAcq.map((row) => reconRow(row, 'AQUISICAO', links)),
    liquidacoesD1: rowsLiq.map((row) => reconRow(row, 'LIQUIDACAO', links)),
    // Retificacao e um fato da importacao/execucao. Ela permanece registrada
    // nos detalhes da execucao abaixo, sem substituir o status economico do titulo.
    contexto: {},
  })
  const counts = Object.fromEntries([...new Set(results.map((row) => row.status))].map((status) => [status, results.filter((row) => row.status === status).length]))
  const totalD1 = rowsD1.reduce((sum, row) => sum.plus(new Decimal(text(row.valor_aquisicao) || 0)), new Decimal(0)).toFixed(2)
  const payload = {
    fundo_id: input.fundoId, data_referencia: input.dataReferencia, regra_versao: RECONCILIATION_RULE_VERSION,
    input_import_ids: inputIds, assinatura_execucao: signature, correlation_id: correlationId,
    criado_por: input.atorUsuarioId, matching_execucao_id: matching.data?.id || null,
    estoque_d2_importacao_id: stockD2!.id, estoque_d1_importacao_id: stockD1!.id,
    aquisicoes_d1_importacao_id: acquisitionsD1!.id, liquidacoes_d1_importacao_id: liquidationsD1!.id,
    status: 'CONCLUIDA', detalhes: {
      estrutura: 'D-2 + aquisicoes D-1 - liquidacoes D-1 = D-1',
      sem_saldo_contabil: true,
      retificacoes_detectadas: {
        estoque: [...stockRetifications],
        aquisicoes: [...acquisitionRetifications],
      },
      bases_sem_movimento: [
        acquisitionsD1!.completude === 'COMPLETO_VAZIO' ? 'AQUISICOES_D1' : null,
        liquidationsD1!.completude === 'COMPLETO_VAZIO' ? 'LIQUIDACOES_D1' : null,
      ].filter(Boolean),
    },
    contagens: counts, valores_agregados: { estoque_d1_valor_aquisicao: totalD1 },
    resultados: results.map((row) => ({
      identidade_externa: row.identidadeExterna, provedor: row.provedor, vinculo_id: row.vinculoId,
      nota_fiscal_id: row.notaFiscalId, presente_d2: row.presenteD2, presente_d1: row.presenteD1,
      valor_aquisicao_d2: row.valorAquisicaoD2, valor_aquisicao_d1: row.valorAquisicaoD1,
      aquisicoes_count: row.aquisicoesCount, aquisicoes_valor: row.aquisicoesValor,
      liquidacoes_count: row.liquidacoesCount, liquidacoes_valor_pago: row.liquidacoesValorPago,
      status: row.status, detalhes: row.detalhes,
    })),
  }
  const { data, error } = await admin().rpc('persistir_conciliacao_execucao', { p_payload: payload })
  if (error) throw new Error(`Nao foi possivel persistir a conciliacao: ${error.message}`)
  return { execucaoId: String(data), status: 'CONCLUIDA' as const, total: results.length, signature, correlationId }
}
