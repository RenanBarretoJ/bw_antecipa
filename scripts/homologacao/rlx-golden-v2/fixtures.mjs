import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DATASET_VERSION, PROVIDER, buildGoldenV2 } from './scenario-definitions.mjs'

export const FIXTURES_ROOT = resolve(process.cwd(), 'scripts/homologacao/rlx-golden-v2/fixtures')

const STOCK_HEADERS = [
  'NOME_FUNDO', 'DOC_FUNDO', 'FUNDO_ID', 'NOME_CEDENTE', 'DOC_CEDENTE', 'NOME_SACADO',
  'DOC_SACADO', 'ID_RECEBIVEL', 'SEU_NUMERO', 'NU_DOCUMENTO', 'TIPO_RECEBIVEL', 'CHAVE_NFE',
  'VALOR_NOMINAL', 'VALOR_PRESENTE', 'VALOR_AQUISICAO', 'VALOR_PDD', 'DATA_REFERENCIA',
  'DATA_EMISSAO', 'DATA_VENCIMENTO_ORIGINAL', 'DATA_AQUISICAO', 'SITUACAO_RECEBIVEL',
  'STATUS_SNAPSHOT', 'REVISAO',
]

const ACQUISITION_HEADERS = [
  'ID_RECEBIVEL', 'SEU_NUMERO', 'NUMERO_DOCUMENTO', 'CPF_CNPJ_CEDENTE', 'CPF_CNPJ_SACADO',
  'TIPO_RECEBIVEL', 'VALOR_COMPRA', 'VALOR_VENCIMENTO', 'ENTRADA', 'DATA_MOVIMENTO', 'CODIGO_MOVIMENTO',
  'DATA_VENCIMENTO', 'FUNDO_ID', 'CHAVE_NFE', 'REVISAO',
]

const LIQUIDATION_HEADERS = [
  'ID_RECEBIVEL', 'SEU_NUMERO', 'DOCUMENTO', 'IDENTIFICACAO_CEDENTE', 'IDENTIFICACAO_SACADO',
  'TIPO_RECEBIVEL', 'ID_TIPO_MOVIMENTO', 'TIPO_MOVIMENTO', 'ST_RECEBIVEL', 'DATA_MOVIMENTO',
  'DATA_AQUISICAO', 'DATA_VENCIMENTO', 'VL_AQUISICAO', 'VALOR_PAGO', 'VALOR_NOMINAL', 'JUROS', 'FUNDO_ID',
]

function csvCell(value) {
  const text = String(value ?? '')
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function csv(headers, rows) {
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\n')}\n`
}

const money = (value) => Number(value).toFixed(2).replace('.', ',')

function stockRow(dataset, item, date, revision = 1, valueOverride = null) {
  const note = item.note
  const identity = item.idRecebivel !== undefined ? item.idRecebivel : (item.bigInteger || item.identity)
  const value = valueOverride ?? item.valueD1 ?? item.value ?? note?.value ?? 999999.99
  return [
    note?.fund.name ?? dataset.mainFund.name,
    note?.fund.cnpj ?? dataset.mainFund.cnpj,
    note?.fund.id ?? dataset.mainFund.id,
    note?.cedent.name ?? 'QA RLX V2 CEDENTE EXTERNO',
    item.cedenteDocumento ?? note?.cedent.cnpj,
    note?.debtor.name ?? 'QA RLX V2 SACADO EXTERNO',
    item.sacadoDocumento ?? note?.debtor.cnpj,
    identity,
    item.seuNumero ?? identity,
    item.numeroDocumento ?? note?.number,
    'NOTA_FISCAL',
    item.chaveNfe ?? '',
    money(value), money(value), money(value), money(0), date,
    note?.issueDate ?? '2026-07-01', item.dueDate ?? note?.dueDate,
    note?.issueDate ?? '2026-07-01', 'ATIVO', 'COMPLETO_COM_DADOS', revision,
  ]
}

function acquisitionRow(item, dataset, revision = 1, valueDelta = 0) {
  const note = item.note
  const value = Number((note.value + valueDelta).toFixed(2))
  return [
    item.bigInteger || item.identity,
    item.propagationOnly ? '' : (item.seuNumero || item.identity),
    item.numeroDocumento || note.number,
    note.cedent.cnpj,
    note.debtor.cnpj,
    'NOTA_FISCAL',
    money(value),
    money(note.value),
    dataset.dates['D-1'],
    dataset.dates['D-1'],
    'AQUISICAO_GOLDEN_V2',
    note.dueDate,
    dataset.mainFund.id,
    item.propagationOnly ? '' : note.key,
    revision,
  ]
}

function liquidationRow(item, dataset, occurrence) {
  const note = item.note
  const partial = item.liquidationType === 'PARTIAL'
  const paid = partial ? Number((note.value * 0.4).toFixed(2)) : note.value
  return [
    item.bigInteger || item.identity,
    item.scenarioId === 'MATCH_PROPAGACAO' ? '' : `V2-${item.scenarioId}`,
    note.number,
    note.cedent.cnpj,
    note.debtor.cnpj,
    'NOTA_FISCAL',
    `${partial ? 'MOV_PARTIAL' : 'MOV_FULL'}_${occurrence}`,
    partial ? 'LIQUIDACAO_PARCIAL' : 'LIQUIDACAO_TOTAL',
    partial ? 'PARCIAL' : 'LIQUIDADO',
    dataset.dates['D-1'],
    note.issueDate,
    note.dueDate,
    money(note.value), money(paid), money(note.value), money(0), dataset.mainFund.id,
  ]
}

function emptyMovement(type, dataset, day, revision = 1) {
  const date = dataset.dates[day]
  if (type === 'AQUISICOES') {
    return csv(['DATA_MOVIMENTO', 'FUNDO_ID', 'STATUS_ARQUIVO', 'VERSAO'], [[date, dataset.mainFund.id, 'SEM_MOVIMENTO', revision]])
  }
  return csv(['DATA_MOVIMENTO', 'FUNDO_ID', 'STATUS_ARQUIVO'], [[date, dataset.mainFund.id, 'SEM_MOVIMENTO']])
}

function portfolio(dataset, day) {
  const values = { 'D-4': 49_000_000, 'D-3': 49_400_000, 'D-2': 50_000_000, 'D-1': 50_350_000 }
  const date = dataset.dates[day]
  return csv(
    ['FUNDO_EXTERNO', 'DOC_FUNDO', 'FUNDO_ID', 'DATA_REFERENCIA', 'VERSAO', 'PATRIMONIO_LIQUIDO', 'PUBLICADA_EM', 'STATUS_SNAPSHOT'],
    [[dataset.mainFund.name, dataset.mainFund.cnpj, dataset.mainFund.id, date, DATASET_VERSION, money(values[day]), `${date}T20:00:00-03:00`, 'COMPLETO_COM_DADOS']],
  )
}

function matchingStock(dataset) {
  return dataset.matching.filter((item) => item.fund === dataset.mainFund)
}

function d1StockItems(dataset) {
  return [
    ...matchingStock(dataset),
    ...dataset.reconciliation.filter((item) => item.inD1).map((item) => ({
      ...item,
      chaveNfe: item.note.key,
      seuNumero: `V2-${item.scenarioId}`,
      numeroDocumento: item.note.number,
    })),
  ]
}

function d2StockItems(dataset) {
  return dataset.reconciliation.filter((item) => item.inD2).map((item) => ({
    ...item,
    chaveNfe: item.note.key,
    seuNumero: `V2-${item.scenarioId}`,
    numeroDocumento: item.note.number,
    valueD1: item.valueD2,
  }))
}

function expectedExternalIdentity(item) {
  if (item.idRecebivel !== undefined && item.idRecebivel) return item.idRecebivel
  if (item.bigInteger || item.identity) {
    if (item.idRecebivel === '') {
      if (item.seuNumero) return item.seuNumero.toUpperCase()
      if (item.chaveNfe) return item.chaveNfe
      return `${item.cedenteDocumento}|${item.sacadoDocumento}|${item.numeroDocumento}|${item.dueDate}|${item.value}`
    }
    return item.bigInteger || item.identity
  }
  return item.identity
}

function expectedMatching(dataset) {
  const cases = []
  const push = (item, origin, method, status = 'MATCH_FORTE', candidateCount = 1, noteId = item.note?.id ?? null, occurrences = 1, methodPhaseB = null) => {
    cases.push({
      scenario_id: item.scenarioId,
      fund_id: (item.fund ?? item.note?.fund).id,
      origin,
      external_identity: expectedExternalIdentity(item),
      expected_nf_id: noteId,
      expected_method_phase_a: method,
      expected_method_phase_b: methodPhaseB ?? (item.scenarioId === 'MATCH_COMPOSTO' && origin === 'ESTOQUE' ? 'ID_RECEBIVEL' : method),
      expected_status: status,
      expected_candidate_count: candidateCount,
      expected_occurrences: occurrences,
    })
  }
  for (const item of matchingStock(dataset)) {
    push(item, 'ESTOQUE', item.expectedMethod, item.expectedStatus, item.expectedCandidateCount, item.expectedNoteId)
  }
  const adversarial = dataset.matching.find((item) => item.scenarioId === 'MATCH_CROSS_FUND_ADV')
  push(adversarial, 'ESTOQUE', 'CHAVE_NFE')
  for (const item of dataset.reconciliation.filter((entry) => entry.inD1)) push(item, 'ESTOQUE', 'CHAVE_NFE')
  for (const item of dataset.reconciliation.filter((entry) => entry.acquisition)) push(item, 'AQUISICAO', 'CHAVE_NFE')
  const propagated = dataset.matching.find((item) => item.scenarioId === 'MATCH_PROPAGACAO')
  push(propagated, 'AQUISICAO', 'ID_RECEBIVEL')
  push(propagated, 'LIQUIDACAO', 'ID_RECEBIVEL')
  for (const item of dataset.reconciliation.filter((entry) => entry.liquidations.length)) {
    push(item, 'LIQUIDACAO', item.inD1 ? 'SEU_NUMERO' : 'ID_RECEBIVEL', 'MATCH_FORTE', 1, item.note.id, item.liquidations.length, 'SEU_NUMERO')
  }
  const stockItems = d1StockItems(dataset)
  const valueOf = (item) => Number(item.valueD1 ?? item.value ?? item.note.value)
  const matchedItems = stockItems.filter((item) => !['AMBIGUO', 'NAO_CONCILIADO', 'CONFLITO'].includes(item.expectedStatus))
  const ambiguousItems = stockItems.filter((item) => item.expectedStatus === 'AMBIGUO')
  const unmatchedItems = stockItems.filter((item) => item.expectedStatus === 'NAO_CONCILIADO')
  const conflictItems = stockItems.filter((item) => item.expectedStatus === 'CONFLITO')
  const sum = (items) => Number(items.reduce((total, item) => total + valueOf(item), 0).toFixed(2))
  const totalValue = sum(stockItems)
  const matchedValue = sum(matchedItems)
  return {
    schema: 'rlx_expected_matching_v2',
    dataset_version: DATASET_VERSION,
    rule_version: 'RLX_MATCH_V1',
    precedence: ['MANUAL_ATIVO', 'CHAVE_NFE', 'SEU_NUMERO_CROSSWALK', 'PROPAGACAO_DETERMINISTICA', 'COMPOSTO', 'AMBIGUO_NAO_CONCILIADO'],
    stock_d1_aggregates: {
      estoque_d1_count: stockItems.length,
      estoque_d1_valor_aquisicao: totalValue,
      matched_count: matchedItems.length,
      matched_valor: matchedValue,
      ambiguo_count: ambiguousItems.length,
      ambiguo_valor: sum(ambiguousItems),
      nao_conciliado_count: unmatchedItems.length,
      nao_conciliado_valor: sum(unmatchedItems),
      conflito_count: conflictItems.length,
      conflito_valor: sum(conflictItems),
      coverage_percent: Number(((matchedItems.length / stockItems.length) * 100).toFixed(4)),
      coverage_value_percent: Number(((matchedValue / totalValue) * 100).toFixed(4)),
    },
    cases,
  }
}

function expectedReconciliation(dataset) {
  const cases = dataset.reconciliation.map((item) => ({
    scenario_id: item.scenarioId,
    external_identity: item.identity,
    expected_status: item.expectedStatus,
    expected_values: {
      presente_d2: item.inD2,
      presente_d1: item.inD1,
      aquisicoes_count: item.acquisition ? 1 : 0,
      liquidacoes_count: item.liquidations.length,
    },
  }))
  for (const item of matchingStock(dataset)) {
    cases.push({
      scenario_id: `${item.scenarioId}_RECON`,
      external_identity: expectedExternalIdentity(item),
      expected_status: item.scenarioId === 'MATCH_PROPAGACAO' ? 'ENTRADA_INCORPORADA' : 'ENTRADA_SEM_AQUISICAO',
      expected_values: {
        presente_d2: false,
        presente_d1: true,
        aquisicoes_count: item.scenarioId === 'MATCH_PROPAGACAO' ? 1 : 0,
        liquidacoes_count: item.scenarioId === 'MATCH_PROPAGACAO' ? 1 : 0,
      },
    })
  }
  return { schema: 'rlx_expected_reconciliation_v2', dataset_version: DATASET_VERSION, rule_version: 'RLX_RECON_V1', cases }
}

export function buildFixtureFiles(dataset = buildGoldenV2()) {
  const files = new Map()
  const stableStock = d2StockItems(dataset).slice(0, 3)
  for (const day of ['D-4', 'D-3']) {
    files.set(`${day}/carteira.csv`, portfolio(dataset, day))
    files.set(`${day}/estoque.csv`, csv(STOCK_HEADERS, stableStock.map((item) => stockRow(dataset, item, dataset.dates[day]))))
    files.set(`${day}/aquisicoes.csv`, emptyMovement('AQUISICOES', dataset, day))
    files.set(`${day}/liquidacoes.csv`, emptyMovement('LIQUIDACOES', dataset, day))
  }
  files.set('D-2/carteira.csv', portfolio(dataset, 'D-2'))
  files.set('D-2/estoque.csv', csv(STOCK_HEADERS, d2StockItems(dataset).map((item) => stockRow(dataset, item, dataset.dates['D-2']))))
  files.set('D-2/aquisicoes.csv', emptyMovement('AQUISICOES', dataset, 'D-2'))
  files.set('D-2/liquidacoes.csv', emptyMovement('LIQUIDACOES', dataset, 'D-2'))

  const initialStockRows = d1StockItems(dataset).map((item) => stockRow(dataset, item, dataset.dates['D-1'], 1,
    item.scenarioId === 'RECON_DIVERGENCIA_VALOR' ? item.valueD2 : null))
  const retifiedStockRows = d1StockItems(dataset).map((item) => stockRow(dataset, item, dataset.dates['D-1'], 2))
  const acquisitions = [
    ...dataset.reconciliation.filter((item) => item.acquisition).map((item) => ({ ...item, propagationOnly: false })),
    { ...dataset.matching.find((item) => item.scenarioId === 'MATCH_PROPAGACAO'), propagationOnly: true },
  ]
  const liquidations = [
    { ...dataset.matching.find((item) => item.scenarioId === 'MATCH_PROPAGACAO'), liquidationType: 'FULL' },
    ...dataset.reconciliation.flatMap((item) => item.liquidations.map((liquidationType) => ({ ...item, liquidationType }))),
  ]
  files.set('D-1/carteira.csv', portfolio(dataset, 'D-1'))
  files.set('D-1/estoque.csv', csv(STOCK_HEADERS, initialStockRows))
  files.set('D-1/aquisicoes.csv', csv(ACQUISITION_HEADERS, acquisitions.map((item) => acquisitionRow(item, dataset, 1))))
  files.set('D-1/liquidacoes.csv', csv(LIQUIDATION_HEADERS, liquidations.map((item, index) => liquidationRow(item, dataset, index + 1))))
  files.set('retificacoes/estoque-D-1-v2.csv', csv(STOCK_HEADERS, retifiedStockRows))
  files.set('retificacoes/aquisicoes-D-1-v2.csv', csv(ACQUISITION_HEADERS, acquisitions.map((item, index) => acquisitionRow(item, dataset, 2, index === 0 ? 50 : 0))))
  files.set('duplicados/estoque-D-1-copia.csv', csv(STOCK_HEADERS, initialStockRows))

  const adversarial = dataset.matching.find((item) => item.scenarioId === 'MATCH_CROSS_FUND_ADV')
  files.set('adversarial/estoque-D-1.csv', csv(STOCK_HEADERS, [stockRow(dataset, adversarial, dataset.dates['D-1'])]))
  files.set('adversarial/aquisicoes-D-1.csv', emptyMovement('AQUISICOES', { ...dataset, mainFund: dataset.adversarialFund }, 'D-1'))
  files.set('adversarial/liquidacoes-D-1.csv', emptyMovement('LIQUIDACOES', { ...dataset, mainFund: dataset.adversarialFund }, 'D-1'))

  files.set('expected/expected-matching.json', `${JSON.stringify(expectedMatching(dataset), null, 2)}\n`)
  files.set('expected/expected-reconciliation.json', `${JSON.stringify(expectedReconciliation(dataset), null, 2)}\n`)
  files.set('expected/expected-executions.json', `${JSON.stringify({
    schema: 'rlx_expected_executions_v2', dataset_version: DATASET_VERSION,
    executions: [
      { phase: 'A', stock_revision: 1, acquisition_revision: 1, immutable_after_retification: true },
      { phase: 'B', stock_revision: 2, acquisition_revision: 2, uses_current_imports: true },
    ],
  }, null, 2)}\n`)
  files.set('expected/expected-import-lifecycle.json', `${JSON.stringify({
    schema: 'rlx_expected_import_lifecycle_v2', dataset_version: DATASET_VERSION,
    duplicate: { fixture: 'duplicados/estoque-D-1-copia.csv', reuses_import: true },
    rectifications: [
      { type: 'ESTOQUE', date: dataset.dates['D-1'], revisions: [1, 2] },
      { type: 'AQUISICOES', date: dataset.dates['D-1'], revisions: [1, 2] },
    ],
    complete_empty: [
      ...['D-4', 'D-3', 'D-2'].flatMap((day) => ['AQUISICOES', 'LIQUIDACOES'].map((type) => ({ day, date: dataset.dates[day], type }))),
    ],
  }, null, 2)}\n`)
  files.set('expected/expected-logistics.json', `${JSON.stringify({
    schema: 'rlx_expected_logistics_v2', dataset_version: DATASET_VERSION,
    authoritative_in_p2_3_1: false, reserved_for: 'P2.4',
    cases: dataset.operations.map((operation, index) => ({
      scenario_id: `LOGISTICA_D0_${String(index + 1).padStart(2, '0')}`,
      operation_id: operation.id,
      nota_fiscal_id: operation.note.id,
      expected_descriptive_status: operation.logistics,
    })),
  }, null, 2)}\n`)
  files.set('expected/expected-exposure.json', `${JSON.stringify({
    schema: 'rlx_expected_exposure_v2', dataset_version: DATASET_VERSION,
    authoritative_decision: false,
    scenarios_percent: [25, 37, 39.8, 40, 42],
    description: 'Contrato descritivo; nenhuma regra de concentracao de 40% e inferida.',
  }, null, 2)}\n`)
  files.set('expected/expected-risk-gate.json', `${JSON.stringify({
    schema: 'expected_risk_gate_v1',
    dataset_version: DATASET_VERSION,
    rule_version: 'GATE_RISCO_V1',
    policy: { active: true, limit_percent: '40', inclusive: true },
    baseline: {
      net_asset_value_d2: '50000000.00',
      known_transit_exposure: '0.00',
      indeterminate: { count: 12, value: '147803.45', expected_reason: 'EXPOSICAO_INDETERMINADA' },
      unmatched: { count: 3, value: '1021648.91', expected_reason: 'POSICAO_SEM_MATCH' },
      expected_decision: 'BLOQUEADO',
    },
    scenarios: [
      { percent: '25', exposure_value: '12500000.00', expected_decision: 'APTO' },
      { percent: '37', exposure_value: '18500000.00', expected_decision: 'APTO' },
      { percent: '39.8', exposure_value: '19900000.00', expected_decision: 'APTO' },
      { percent: '40', exposure_value: '20000000.00', expected_decision: 'APTO', expected_reason: 'NO_LIMITE' },
      { percent: '42', exposure_value: '21000000.00', expected_decision: 'BLOQUEADO', expected_reason: 'EXPOSICAO_ACIMA_LIMITE' },
    ],
  }, null, 2)}\n`)
  return files
}

export function buildManifest(dataset = buildGoldenV2(), files = buildFixtureFiles(dataset)) {
  return {
    schema: 'rlx_golden_manifest_v2', dataset_version: DATASET_VERSION,
    base_date: dataset.baseDate, timezone: dataset.timezone, business_dates: dataset.dates,
    provider: PROVIDER, funds: dataset.funds.map(({ id, name, cnpj }) => ({ id, name, cnpj })),
    counts: {
      notes: dataset.notes.length,
      operations_d0: dataset.operations.length,
      risk_candidate_operations: dataset.riskCandidateOperation ? 1 : 0,
      boleto_documents: dataset.boletoDocuments.length,
      matching_scenarios: dataset.matching.length,
      reconciliation_scenarios: dataset.reconciliation.length,
    },
    files: [...files].map(([path, content]) => ({ path, sha256: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content) })),
  }
}

export function writeFixtures({ check = false } = {}) {
  const dataset = buildGoldenV2()
  const files = buildFixtureFiles(dataset)
  files.set('manifest.json', `${JSON.stringify(buildManifest(dataset, files), null, 2)}\n`)
  const differences = []
  for (const [relativePath, content] of files) {
    const target = resolve(FIXTURES_ROOT, relativePath)
    if (check) {
      if (!existsSync(target) || readFileSync(target, 'utf8') !== content) differences.push(relativePath)
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
  return { files, differences }
}
