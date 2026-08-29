import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import {
  BASE_DATE,
  DATASET_VERSION,
  TIMEZONE,
  addDays,
  buildDataset,
} from './helpers.mjs'

export const FIXTURES_ROOT = resolve(process.cwd(), 'scripts/homologacao/rlx-golden/fixtures')

function csvCell(value) {
  const text = String(value ?? '')
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function csv(headers, rows, { bom = false } = {}) {
  const content = [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\n') + '\n'
  return `${bom ? '\uFEFF' : ''}${content}`
}

function brDecimal(value) {
  return Number(value).toFixed(2).replace('.', ',')
}

function stockAcquisitionValue(note) {
  return Number((note.value * (0.935 + (note.index % 5) * 0.004)).toFixed(2))
}

function carteira(dataset, day) {
  const pls = { 'D-4': 48_000_000, 'D-3': 49_200_000, 'D-2': 50_000_000, 'D-1': 50_700_000 }
  return csv(
    ['FUNDO_EXTERNO', 'DOC_FUNDO', 'FUNDO_ID', 'DATA_REFERENCIA', 'VERSAO', 'PATRIMONIO_LIQUIDO', 'PUBLICADA_EM', 'STATUS_SNAPSHOT'],
    [[dataset.mainFund.name, dataset.mainFund.cnpj, dataset.mainFund.id, addDays(BASE_DATE, -Number(day.slice(2))), 'CARTEIRA_GOLDEN_V1', brDecimal(pls[day]), `${addDays(BASE_DATE, -Number(day.slice(2)))}T20:00:00-03:00`, 'COMPLETO_COM_DADOS']],
  )
}

function estoqueRows(notes, day, revision = 1) {
  const offset = Number(day.slice(2))
  if (day === 'D-1' && revision === 2) notes = [...notes.slice(0, 8), ...notes.slice(9)].map((note, index) => index === 3 ? { ...note, value: note.value + 321.45 } : note)
  return notes.map((note) => [
    note.fund.name, note.fund.cnpj, note.fund.id, note.cedent.name, note.cedent.cnpj,
    note.debtor.name, note.debtor.cnpj, note.externalReceivableId, note.seuNumero, note.number,
    'NOTA_FISCAL', note.key, brDecimal(note.value), brDecimal(stockAcquisitionValue(note)),
    brDecimal(stockAcquisitionValue(note)), brDecimal(0), addDays(BASE_DATE, -offset), note.issueDate,
    note.dueDate, addDays(note.issueDate, 2), 'ATIVO', 'COMPLETO_COM_DADOS', revision,
  ])
}

const stockHeaders = [
  'NOME_FUNDO', 'DOC_FUNDO', 'FUNDO_ID', 'NOME_CEDENTE', 'DOC_CEDENTE', 'NOME_SACADO',
  'DOC_SACADO', 'ID_RECEBIVEL', 'SEU_NUMERO', 'NU_DOCUMENTO', 'TIPO_RECEBIVEL', 'CHAVE_NFE',
  'VALOR_NOMINAL', 'VALOR_PRESENTE', 'VALOR_AQUISICAO', 'VALOR_PDD', 'DATA_REFERENCIA',
  'DATA_EMISSAO', 'DATA_VENCIMENTO_ORIGINAL', 'DATA_AQUISICAO', 'SITUACAO_RECEBIVEL',
  'STATUS_SNAPSHOT', 'REVISAO',
]

function estoque(dataset, day, revision = 1) {
  const offset = Number(day.slice(2))
  let notes = dataset.mainNotes.slice(0, 82 + (4 - offset) * 2)
  if (day === 'D-1') notes = dataset.stockD1
  return csv(stockHeaders, estoqueRows(notes, day, revision))
}

function estoqueAdversarial(dataset) {
  const notes = dataset.notes.filter((note) => note.fund === dataset.adversarialFund).slice(0, 12)
  return csv(stockHeaders, estoqueRows(notes, 'D-1'))
}

function aquisicoes(dataset, day, revision = 1) {
  const date = addDays(BASE_DATE, -Number(day.slice(2)))
  const matching = dataset.acquisitions.filter((item) => item.date === date)
  if (!matching.length) {
    return csv(['DATA_MOVIMENTO', 'FUNDO_ID', 'STATUS_ARQUIVO', 'VERSAO'], [[date, dataset.mainFund.id, 'SEM_MOVIMENTO', revision]])
  }
  const rows = matching.map((item, index) => [
    item.note.externalReceivableId, item.note.seuNumero, item.note.number, item.note.cedent.cnpj,
    item.note.debtor.cnpj, 'NOTA_FISCAL', brDecimal(item.value + (revision === 2 && index === 0 ? -500 : 0)),
    brDecimal(item.note.value), 'AQUISICAO_QA', item.date, item.note.dueDate, item.note.fund.id,
    item.note.key, revision,
  ])
  return csv(['ID_RECEBIVEL', 'SEU_NUMERO', 'NUMERO_DOCUMENTO', 'CPF_CNPJ_CEDENTE', 'CPF_CNPJ_SACADO', 'TIPO_RECEBIVEL', 'VALOR_COMPRA', 'VALOR_VENCIMENTO', 'ENTRADA', 'DATA_MOVIMENTO', 'DATA_VENCIMENTO', 'FUNDO_ID', 'CHAVE_NFE', 'REVISAO'], rows)
}

function liquidacoes(dataset, day) {
  const date = addDays(BASE_DATE, -Number(day.slice(2)))
  const matching = dataset.liquidations.filter((item) => item.date === date)
  if (!matching.length) {
    return csv(['DATA_MOVIMENTO', 'FUNDO_ID', 'STATUS_ARQUIVO'], [[date, dataset.mainFund.id, 'SEM_MOVIMENTO']])
  }
  const rows = matching.map((item) => [
    item.note.externalReceivableId, item.note.seuNumero, item.note.number, item.note.cedent.cnpj,
    item.note.debtor.cnpj, 'NOTA_FISCAL', item.code, item.code,
    item.code === 'MOV_FULL' ? 'LIQUIDADO_QA' : 'PARCIAL_QA', item.date,
    addDays(item.note.issueDate, 2), item.note.dueDate, brDecimal(stockAcquisitionValue(item.note)),
    brDecimal(item.value), brDecimal(item.note.value), brDecimal(0), item.note.fund.id,
  ])
  return csv(['ID_RECEBIVEL', 'SEU_NUMERO', 'DOCUMENTO', 'IDENTIFICACAO_CEDENTE', 'IDENTIFICACAO_SACADO', 'TIPO_RECEBIVEL', 'ID_TIPO_MOVIMENTO', 'TIPO_MOVIMENTO', 'ST_RECEBIVEL', 'DATA_MOVIMENTO', 'DATA_AQUISICAO', 'DATA_VENCIMENTO', 'VL_AQUISICAO', 'VALOR_PAGO', 'VALOR_NOMINAL', 'JUROS', 'FUNDO_ID'], rows)
}

function expectedMatching(dataset) {
  return {
    schema: 'rlx_expected_matching_v1', datasetVersion: DATASET_VERSION,
    rules: [
      { order: 1, code: 'MATCH_ID_RECEBIVEL', scope: ['fundo_id', 'provedor', 'id_recebivel'] },
      { order: 2, code: 'MATCH_SEU_NUMERO', scope: ['fundo_id', 'provedor', 'seu_numero'] },
      { order: 3, code: 'MATCH_CHAVE_NFE', scope: ['fundo_id', 'chave_nfe'] },
      { order: 4, code: 'MATCH_COMPOSTO', scope: ['fundo_id', 'cedente', 'sacado', 'documento', 'vencimento', 'valor'] },
    ],
    crossFundCollision: {
      seuNumero: 'QA-000001', idRecebivel: '900719925474099312345',
      mainNoteId: dataset.mainNotes[0].id,
      adversarialNoteId: dataset.notes.find((note) => note.fund === dataset.adversarialFund).id,
      expected: 'DOIS_MATCHES_INDEPENDENTES_POR_FUNDO',
    },
    bigIntegerContract: { type: 'string', sample: '900719925474099312345' },
    cases: [...dataset.stockD1, ...dataset.notes.filter((note) => note.fund === dataset.adversarialFund).slice(0, 12)].map((note, index) => {
      const expectedMethod = index % 17 === 0 ? 'AMBIGUO' : index % 19 === 0 ? 'NAO_CONCILIADO' : index % 11 === 0 ? 'COMPOSTO' : index % 7 === 0 ? 'SEU_NUMERO' : 'CHAVE_NFE'
      return {
        fundId: note.fund.id, provider: 'SC1_SINQIA_GOLDEN', externalTitleId: note.externalReceivableId,
        expectedNfId: ['AMBIGUO', 'NAO_CONCILIADO'].includes(expectedMethod) ? null : note.id,
        expectedMethod, expectedStatus: expectedMethod === 'AMBIGUO' ? 'AMBIGUO' : expectedMethod === 'NAO_CONCILIADO' ? 'NAO_CONCILIADO' : 'MATCH_FORTE',
      }
    }),
  }
}

function expectedReconciliation(dataset) {
  const n = dataset.mainNotes
  return {
    schema: 'rlx_expected_reconciliation_v1', datasetVersion: DATASET_VERSION,
    formula: 'estoque_D2 + aquisicoes_D1 - liquidacoes_D1 = estoque_D1',
    cases: [
      ['MANTIDO_CORRETO', n[0]], ['ENTRADA_INCORPORADA', n[73]], ['ENTRADA_NAO_INCORPORADA', n[100]],
      ['SAIDA_REFLETIDA', n[12]], ['SAIDA_NAO_REFLETIDA', n[14]], ['LIQUIDADO_AINDA_NO_ESTOQUE', n[15]],
      ['DIVERGENCIA_VALOR', n[16]], ['NAO_CONCILIADO', n[107]], ['BASE_INCOMPLETA', n[18]],
      ['SAIDA_SEM_LIQUIDACAO', n[19]], ['RETIFICACAO_ESTOQUE', n[3]], ['RETIFICACAO_AQUISICAO', n[74]],
      ['LIQUIDACAO_REPETIDA_MESMO_DIA', n[13]], ['LIQUIDACAO_PARCIAL_SALDO', n[8]],
      ['DIA_SEM_MOVIMENTO', n[21]], ['ARQUIVO_DUPLICADO_HASH', n[22]],
    ].map(([code, note]) => ({
      code, dataReference: addDays(BASE_DATE, -1), fundId: note.fund.id,
      externalTitleId: note.externalReceivableId, noteId: note.id, expected: code,
    })),
    incompleteSnapshotMustBlock: true,
  }
}

function expectedLogistics(dataset) {
  const byStatus = Object.groupBy(dataset.notes, (note) => note.logistics)
  return {
    schema: 'rlx_expected_logistics_v1', datasetVersion: DATASET_VERSION,
    derivation: {
      ENTREGUE: 'comprovante_entrega aprovado',
      EM_TRANSITO: 'cte_xml aprovado e sem comprovante_entrega aprovado',
      INDETERMINADA: 'evidencia insuficiente, pendente ou rejeitada',
    },
    counts: Object.fromEntries(Object.entries(byStatus).map(([key, values]) => [key, values.length])),
    cases: dataset.notes.map((note) => ({ noteId: note.id, fundId: note.fund.id, expected: note.logistics })),
  }
}

function expectedExposure(dataset) {
  const pl = 50_000_000
  const percentages = [25, 37, 39.8, 40, 42]
  const stockTotal = dataset.stockD1.reduce((total, note) => total + stockAcquisitionValue(note), 0)
  const stockTransit = dataset.stockD1.filter((note) => note.logistics === 'EM_TRANSITO').reduce((total, note) => total + stockAcquisitionValue(note), 0)
  const intradayTransit = dataset.operations.filter((operation) => operation.note.logistics === 'EM_TRANSITO').reduce((total, operation) => total + stockAcquisitionValue(operation.note), 0)
  return {
    schema: 'rlx_expected_exposure_v1', datasetVersion: DATASET_VERSION,
    authoritativeDecision: false,
    plD2: pl,
    scenarios: percentages.map((percentage) => ({
      code: `EXPOSICAO_${String(percentage).replace('.', '_')}_PCT`, percentage,
      exposure: Number((pl * percentage / 100).toFixed(2)),
      expected: 'FIXTURE_ONLY_NO_ELIGIBILITY_DECISION',
    })),
    intradayOverlay: {
      operationIds: dataset.operations.map((item) => item.id),
      absentFromStockD1: dataset.operations.every((item) => !dataset.stockD1.some((note) => note.id === item.note.id)),
      estoqueD1ValorAquisicaoTotal: Number(stockTotal.toFixed(2)),
      estoqueD1EmTransitoValorAquisicao: Number(stockTransit.toFixed(2)),
      intradayEmTransitoValorAquisicao: Number(intradayTransit.toFixed(2)),
      plD2: pl,
      percentualBase: Number((stockTransit / pl * 100).toFixed(6)),
      percentualComOverlay: Number(((stockTransit + intradayTransit) / pl * 100).toFixed(6)),
    },
  }
}

export function buildFixtureFiles(dataset = buildDataset()) {
  const files = new Map()
  for (const day of ['D-4', 'D-3', 'D-2', 'D-1']) {
    files.set(`${day}/carteira.csv`, carteira(dataset, day))
    files.set(`${day}/estoque.csv`, estoque(dataset, day))
    files.set(`${day}/aquisicoes.csv`, aquisicoes(dataset, day))
    files.set(`${day}/liquidacoes.csv`, liquidacoes(dataset, day))
  }
  files.set('retificacoes/estoque-D-1-v2.csv', estoque(dataset, 'D-1', 2))
  files.set('retificacoes/aquisicoes-D-2-v2.csv', aquisicoes(dataset, 'D-2', 2))
  files.set('adversarial/estoque-D-1.csv', estoqueAdversarial(dataset))
  files.set('edge-cases/matching-identifiers.csv', csv(
    ['FUNDO_ID', 'SEU_NUMERO', 'ID_RECEBIVEL', 'CHAVE_NFE', 'EXPECTED'],
    [
      [dataset.mainFund.id, 'QA-VALIDA', '900719925474099312346', dataset.mainNotes[2].key, 'MATCH_FORTE'],
      [dataset.adversarialFund.id, 'QA-000001', '900719925474099312345', dataset.notes.find((note) => note.fund === dataset.adversarialFund).key, 'NAO_CRUZAR_FUNDOS'],
      [dataset.mainFund.id, 'QA-SEM-CHAVE', '900719925474099312347', '', 'FALLBACK_EXPLICITO'],
      [dataset.mainFund.id, 'QA-MALFORMADA', '900719925474099312348', '12345', 'CHAVE_INVALIDA'],
      [dataset.adversarialFund.id, 'QA-DUPLICADA', '900719925474099312349', dataset.mainNotes[2].key, 'NAO_MATCH_CROSS_FUND'],
    ],
  ))
  files.set('edge-cases/utf8-bom.csv', csv(['ID_RECEBIVEL', 'DESCRICAO'], [['000900719925474099312345', 'campo com BOM']], { bom: true }))
  files.set('edge-cases/quoted-semicolon.csv', csv(['ID_RECEBIVEL', 'DESCRICAO'], [['900719925474099312345', 'mercadoria; lote A']]))
  files.set('edge-cases/blank-file.csv', '')
  files.set('edge-cases/extra-column.csv', 'ID_RECEBIVEL;VALOR;COLUNA_NOVA\n1;10,00;nao_mapeada\n')
  files.set('edge-cases/impossible-date.csv', 'ID_RECEBIVEL;DATA_MOVIMENTO\n1;31/02/2026\n')
  files.set('edge-cases/decimal-formats.csv', 'ID;VALOR\n1;1,000.00\n2;1.000,00\n')
  files.set('edge-cases/required-blank.csv', 'ID_RECEBIVEL;SEU_NUMERO\n;QA-SEM-ID\n')
  files.set('edge-cases/alternate-header.csv', 'receivable_id;your_number;amount\n1;QA-ALT;10.00\n')
  files.set('edge-cases/latin1.csv', Buffer.from('ID;DESCRICAO\n1;Aquisiçao retificada\n', 'latin1'))
  files.set('edge-cases/incomplete-snapshot.json', JSON.stringify({ status: 'INCOMPLETO', reason: 'arquivo truncado', mustBlock: true }, null, 2) + '\n')
  files.set('edge-cases/duplicate-file-reference.json', JSON.stringify({
    first: 'D-1/estoque.csv', duplicate: 'duplicados/estoque-D-1-copia.csv', expected: 'DUPLICATE_HASH',
  }, null, 2) + '\n')
  files.set('duplicados/estoque-D-1-copia.csv', files.get('D-1/estoque.csv'))
  files.set('expected/expected-matching.json', JSON.stringify(expectedMatching(dataset), null, 2) + '\n')
  files.set('expected/expected-reconciliation.json', JSON.stringify(expectedReconciliation(dataset), null, 2) + '\n')
  files.set('expected/expected-logistics.json', JSON.stringify(expectedLogistics(dataset), null, 2) + '\n')
  files.set('expected/expected-exposure.json', JSON.stringify(expectedExposure(dataset), null, 2) + '\n')
  return files
}

export function buildManifest(dataset = buildDataset(), files = buildFixtureFiles(dataset)) {
  const hashes = Object.fromEntries([...files].map(([path, content]) => [path, createContentHash(content)]))
  return {
    schema: 'rlx_golden_manifest_v1', datasetVersion: DATASET_VERSION, baseDate: BASE_DATE, timezone: TIMEZONE,
    warning: 'Fixtures sinteticas de QA; nao representam layout oficial da Administradora ou Sinqia.',
    funds: dataset.funds.map((fund) => ({ id: fund.id, name: fund.name, cnpj: fund.cnpj })),
    counts: {
      cedents: dataset.cedents.length, debtors: dataset.debtors.length, notes: dataset.notes.length,
      mainNotes: dataset.mainNotes.length, adversarialNotes: dataset.notes.length - dataset.mainNotes.length,
      boletoDocuments: dataset.documents.filter((item) => item.family === 'boleto').length,
      stockD1: dataset.stockD1.length, acquisitions: dataset.acquisitions.length,
      liquidations: dataset.liquidations.length, intradayOperations: dataset.operations.length,
    },
    portfolioValues: {
      noteGrossTotal: Number(dataset.notes.reduce((sum, note) => sum + note.value, 0).toFixed(2)),
      operationGrossTotal: Number(dataset.operations.reduce((sum, operation) => sum + operation.note.value, 0).toFixed(2)),
    },
    pl: { 'D-4': 48_000_000, 'D-3': 49_200_000, 'D-2': 50_000_000, 'D-1': 50_700_000 },
    timeline: {
      'D-4': { carteira: 'COMPLETO_COM_DADOS', estoque: 'COMPLETO_COM_DADOS', aquisicoes: 'SEM_MOVIMENTO', liquidacoes: 'SEM_MOVIMENTO' },
      'D-3': { carteira: 'COMPLETO_COM_DADOS', estoque: 'COMPLETO_COM_DADOS', aquisicoes: 'COM_MOVIMENTO', liquidacoes: 'COM_MOVIMENTO' },
      'D-2': { carteira: 'COMPLETO_COM_DADOS', estoque: 'COMPLETO_COM_DADOS', aquisicoes: 'COM_MOVIMENTO', liquidacoes: 'SEM_MOVIMENTO' },
      'D-1': { carteira: 'COMPLETO_COM_DADOS', estoque: 'COMPLETO_COM_DADOS', aquisicoes: 'SEM_MOVIMENTO', liquidacoes: 'COM_MOVIMENTO' },
      D0: { operacoesBw: 'APROVADAS_NAO_REFLETIDAS_NO_ESTOQUE_D1' },
    },
    ids: {
      funds: dataset.funds.map((item) => item.id), cedents: dataset.cedents.map((item) => item.id),
      debtors: dataset.debtors.map((item) => item.id), notes: dataset.notes.map((item) => item.id),
      operations: dataset.operations.map((item) => item.id), documents: dataset.documents.map((item) => item.id),
    },
    files: [...files.keys()].sort(), hashes,
    scenarios: {
      boleto: [...new Set(dataset.notes.map((item) => item.boletoScenario))].sort(),
      logistics: ['ENTREGUE', 'EM_TRANSITO', 'INDETERMINADA'],
      reconciliation: expectedReconciliation(dataset).cases.map((item) => item.code),
      exposurePercentages: [25, 37, 39.8, 40, 42],
    },
    expected: {
      matching: 'expected/expected-matching.json', reconciliation: 'expected/expected-reconciliation.json',
      logistics: 'expected/expected-logistics.json', exposure: 'expected/expected-exposure.json',
    },
    fixtureContracts: {
      carteira: 'CARTEIRA_GOLDEN_V1_CANONICA_QA_NAO_OFICIAL',
      estoque: 'INSPIRADO_SC1_SINQIA_GOLDEN_TEST_INPUT',
      aquisicoes: 'INSPIRADO_SC1_SINQIA_GOLDEN_TEST_INPUT',
      liquidacoes: 'INSPIRADO_SC1_SINQIA_GOLDEN_TEST_INPUT',
      omittedStockFields: ['CODIGO_RATING', 'PROVISAO_ANALITICA', 'COOBRIGACAO', 'INDEXADOR'],
    },
    openQuestions: [
      'Layouts oficiais de Carteira, Estoque, Aquisicoes e Liquidacoes ainda nao foram homologados.',
      'Catalogo oficial de tipos de movimento e semantica de liquidacao parcial ainda nao foi confirmado.',
      'Boleto/Duplicata Digital permanece evidencia documental; nao e parser financeiro nesta fase.',
    ],
  }
}

function createContentHash(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
  return createHash('sha256').update(bytes).digest('hex')
}

export function writeFixtures({ check = false } = {}) {
  const dataset = buildDataset()
  const files = buildFixtureFiles(dataset)
  files.set('manifest.json', JSON.stringify(buildManifest(dataset, files), null, 2) + '\n')
  const differences = []
  for (const [path, content] of files) {
    const target = resolve(FIXTURES_ROOT, path)
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content)
    if (check) {
      if (!existsSync(target) || !readFileSync(target).equals(bytes)) differences.push(path)
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
  return { dataset, files, differences }
}

export function fixtureRelativePath(path) {
  return relative(process.cwd(), resolve(FIXTURES_ROOT, path)).replaceAll('\\', '/')
}
