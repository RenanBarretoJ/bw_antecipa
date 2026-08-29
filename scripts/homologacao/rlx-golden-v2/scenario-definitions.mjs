import {
  cnpjDigits,
  deterministicUuid,
  nfeKey,
} from '../rlx-golden/helpers.mjs'

export const DATASET_VERSION = 'RLX_GOLDEN_V2'
export const BASE_DATE = '2026-08-10'
export const TIMEZONE = 'America/Sao_Paulo'
export const PROVIDER = 'rlx_golden_v2'
export const MAIN_FUND_NAME = 'QA RLX GOLDEN V2 FIDC'
export const ADVERSARIAL_FUND_NAME = 'QA RLX GOLDEN V2 ADVERSARIAL FIDC'

const ANBIMA_HOLIDAYS_2026 = new Set([
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21',
  '2026-05-01', '2026-06-04', '2026-09-07', '2026-10-12', '2026-11-02',
  '2026-11-15', '2026-11-20', '2026-12-25',
])

function isoDate(value) {
  return new Date(`${value}T12:00:00.000Z`)
}

function dateString(value) {
  return value.toISOString().slice(0, 10)
}

export function previousAnbimaBusinessDay(value) {
  const date = isoDate(value)
  do date.setUTCDate(date.getUTCDate() - 1)
  while ([0, 6].includes(date.getUTCDay()) || ANBIMA_HOLIDAYS_2026.has(dateString(date)))
  return dateString(date)
}

export const BUSINESS_DATES = (() => {
  /** @type {Record<'D-1' | 'D-2' | 'D-3' | 'D-4', string>} */
  const result = {}
  let cursor = BASE_DATE
  for (let offset = 1; offset <= 4; offset += 1) {
    cursor = previousAnbimaBusinessDay(cursor)
    result[`D-${offset}`] = cursor
  }
  const expected = { 'D-1': '2026-08-07', 'D-2': '2026-08-06', 'D-3': '2026-08-05', 'D-4': '2026-08-04' }
  if (JSON.stringify(result) !== JSON.stringify(expected)) {
    throw new Error(`Calendario ANBIMA divergente: ${JSON.stringify(result)}`)
  }
  return Object.freeze(result)
})()

const uid = (key) => deterministicUuid(`${DATASET_VERSION}:${key}`)

function fund(key, name, cnpjBase) {
  return {
    key,
    id: uid(`fund:${key}`),
    name,
    cnpj: cnpjDigits(cnpjBase),
    policyId: uid(`policy:${key}`),
    policyVersionId: uid(`policy-version:${key}:1`),
    policyCode: `QA_RLX_V2_${key.toUpperCase()}_NF`,
    requirementIds: {
      boleto: uid(`policy-requirement:${key}:boleto`),
      cte: uid(`policy-requirement:${key}:cte`),
      proof: uid(`policy-requirement:${key}:proof`),
    },
  }
}

export const FUNDS = Object.freeze({
  main: fund('main', MAIN_FUND_NAME, '848100000001'),
  adversarial: fund('adversarial', ADVERSARIAL_FUND_NAME, '848100000002'),
})

function addCalendarDays(value, amount) {
  const date = isoDate(value)
  date.setUTCDate(date.getUTCDate() + amount)
  return dateString(date)
}

function buildParties() {
  const cedents = Array.from({ length: 6 }, (_, index) => ({
    id: uid(`cedent:${index + 1}`),
    userKey: `cedent-${index + 1}`,
    fund: index < 5 ? FUNDS.main : FUNDS.adversarial,
    linkId: uid(`cedent-fund:${index + 1}`),
    assignmentId: uid(`cedent-policy:${index + 1}`),
    cnpj: cnpjDigits(`8482${String(index + 1).padStart(8, '0')}`),
    name: `QA RLX V2 CEDENTE ${String(index + 1).padStart(2, '0')}`,
  }))
  const debtors = Array.from({ length: 8 }, (_, index) => ({
    id: uid(`debtor:${index + 1}`),
    userKey: `debtor-${index + 1}`,
    cnpj: cnpjDigits(`8483${String(index + 1).padStart(8, '0')}`),
    name: `QA RLX V2 SACADO ${String(index + 1).padStart(2, '0')}`,
  }))
  return { cedents, debtors }
}

function buildNotes(cedents, debtors) {
  const specs = [
    { fund: FUNDS.main, count: 100, scopedCedents: cedents.slice(0, 5) },
    { fund: FUNDS.adversarial, count: 10, scopedCedents: cedents.slice(5) },
  ]
  let globalIndex = 0
  const notes = specs.flatMap(({ fund: scopedFund, count, scopedCedents }) => Array.from({ length: count }, (_, localIndex) => {
    globalIndex += 1
    const cedent = scopedCedents[localIndex % scopedCedents.length]
    const debtor = debtors[(globalIndex * 3) % debtors.length]
    const number = `${scopedFund.key === 'main' ? '82' : '92'}${String(localIndex + 1).padStart(7, '0')}`
    const value = Number((10000 + globalIndex * 137.41).toFixed(2))
    return {
      index: globalIndex,
      localIndex: localIndex + 1,
      id: uid(`note:${scopedFund.key}:${localIndex + 1}`),
      fund: scopedFund,
      cedent,
      debtor,
      number,
      key: nfeKey({ cnpj: cedent.cnpj, number: localIndex + 1, seed: 5000 + globalIndex }),
      issueDate: addCalendarDays(BASE_DATE, -60 + (globalIndex % 20)),
      dueDate: addCalendarDays(BASE_DATE, 20 + (globalIndex % 45)),
      value,
    }
  }))

  // Duas NFs deliberadamente indistinguiveis apenas pela composicao, sem compartilhar chave.
  const ambiguousBase = notes[4]
  notes[5] = {
    ...notes[5],
    number: ambiguousBase.number,
    cedent: ambiguousBase.cedent,
    debtor: ambiguousBase.debtor,
    issueDate: ambiguousBase.issueDate,
    dueDate: ambiguousBase.dueDate,
    value: ambiguousBase.value,
  }
  return notes
}

function source(id, note, overrides = {}) {
  return {
    scenarioId: id,
    identity: `V2-${id}`,
    note,
    fund: note?.fund ?? FUNDS.main,
    seuNumero: `V2-${id}`,
    chaveNfe: note?.key ?? null,
    numeroDocumento: note?.number ?? `EXT-${id}`,
    cedenteDocumento: note?.cedent.cnpj ?? cnpjDigits('848299999999'),
    sacadoDocumento: note?.debtor.cnpj ?? cnpjDigits('848399999999'),
    dueDate: note?.dueDate ?? addCalendarDays(BASE_DATE, 50),
    value: note?.value ?? 999999.99,
    expectedMethod: 'CHAVE_NFE',
    expectedStatus: 'MATCH_FORTE',
    expectedCandidateCount: 1,
    expectedNoteId: note?.id ?? null,
    ...overrides,
  }
}

export function buildGoldenV2() {
  const { cedents, debtors } = buildParties()
  const notes = buildNotes(cedents, debtors)
  const mainNotes = notes.filter((note) => note.fund === FUNDS.main)
  const adversarialNotes = notes.filter((note) => note.fund === FUNDS.adversarial)

  const operationNotes = [10, 19, 30, 39, 50, 59, 70, 79, 90, 99].map((position) => mainNotes[position - 1])
  const logisticsCycle = ['ENTREGUE', 'EM_TRANSITO', 'INDETERMINADA']
  const operations = operationNotes.map((note, index) => ({
    id: uid(`operation:${index + 1}`),
    note,
    rate: [1.49, 1.79, 1.99, 2.19, 2.49][index % 5],
    logistics: logisticsCycle[index % logisticsCycle.length],
    createdAt: `${BASE_DATE}T${String(9 + Math.floor(index / 4)).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')}:00-03:00`,
    approvedAt: `${BASE_DATE}T${String(12 + Math.floor(index / 5)).padStart(2, '0')}:${String((index * 11) % 60).padStart(2, '0')}:00-03:00`,
  }))
  const riskCandidateOperation = {
    id: uid('operation:risk-candidate'),
    note: mainNotes[0],
    rate: 1.79,
    logistics: 'INDETERMINADA',
    createdAt: `${BASE_DATE}T15:30:00-03:00`,
    approvedAt: null,
  }
  const operationByNote = new Map(operations.map((operation) => [operation.note.id, operation]))
  for (const note of notes) note.operation = operationByNote.get(note.id) ?? null

  const boletoDocuments = notes.map((note) => ({
    id: uid(`document:boleto:${note.fund.key}:${note.localIndex}`),
    versionId: uid(`document-version:boleto:${note.fund.key}:${note.localIndex}:1`),
    analysisId: uid(`document-analysis:boleto:${note.fund.key}:${note.localIndex}:1`),
    linkId: uid(`document-link:boleto:${note.fund.key}:${note.localIndex}`),
    requirementInstanceId: uid(`requirement-instance:boleto:${note.fund.key}:${note.localIndex}`),
    note,
    status: 'aprovado',
    uploadedAt: `${BUSINESS_DATES['D-1']}T10:${String(note.index % 60).padStart(2, '0')}:00-03:00`,
  }))

  const matching = [
    source('MATCH_CHAVE', mainNotes[0]),
    source('MATCH_SEU_NUMERO', mainNotes[1], {
      chaveNfe: null,
      expectedMethod: 'SEU_NUMERO',
      seedCrosswalk: { type: 'SEU_NUMERO', note: mainNotes[1] },
    }),
    source('MATCH_PROPAGACAO', mainNotes[2], { bigInteger: '900719925474099312345' }),
    source('MATCH_COMPOSTO', mainNotes[3], {
      chaveNfe: null,
      seuNumero: '',
      expectedMethod: 'COMPOSTO',
    }),
    source('MATCH_AMBIGUO', mainNotes[4], {
      chaveNfe: null,
      seuNumero: '',
      expectedMethod: 'AMBIGUO',
      expectedStatus: 'AMBIGUO',
      expectedCandidateCount: 2,
      expectedNoteId: null,
    }),
    source('MATCH_NAO_CONCILIADO', null, {
      chaveNfe: null,
      seuNumero: '',
      expectedMethod: 'NAO_CONCILIADO',
      expectedStatus: 'NAO_CONCILIADO',
      expectedCandidateCount: 0,
    }),
    source('MATCH_CONFLITO', mainNotes[6], {
      seuNumero: 'V2-CONFLITO-CROSSWALK',
      expectedMethod: 'CONFLITO',
      expectedStatus: 'CONFLITO',
      expectedCandidateCount: 2,
      expectedNoteId: null,
      seedCrosswalk: { type: 'SEU_NUMERO', note: mainNotes[7] },
    }),
    source('MATCH_CROSS_FUND_MAIN', mainNotes[8], {
      identity: '900719925474099399999',
      seuNumero: 'V2-CROSS-FUND',
    }),
    source('MATCH_CROSS_FUND_ADV', adversarialNotes[0], {
      identity: '900719925474099399999',
      seuNumero: 'V2-CROSS-FUND',
    }),
  ]

  const reconSpecs = [
    ['RECON_MANTIDO', mainNotes[20], true, true, false, []],
    ['RECON_ENTRADA_INCORPORADA', mainNotes[21], false, true, true, []],
    ['RECON_ENTRADA_NAO_INCORPORADA', mainNotes[22], false, false, true, []],
    ['RECON_ENTRADA_SEM_AQUISICAO', mainNotes[23], false, true, false, []],
    ['RECON_SAIDA_REFLETIDA', mainNotes[24], true, false, false, ['FULL']],
    ['RECON_SAIDA_SEM_LIQUIDACAO', mainNotes[25], true, false, false, []],
    ['RECON_LIQUIDADO_NO_ESTOQUE', mainNotes[26], true, true, false, ['FULL']],
    ['RECON_LIQUIDACAO_PARCIAL', mainNotes[27], true, true, false, ['PARTIAL']],
    ['RECON_LIQUIDACAO_REPETIDA', mainNotes[28], true, true, false, ['FULL', 'FULL']],
    ['RECON_DIVERGENCIA_VALOR', mainNotes[29], true, true, false, []],
  ]
  const expectedStatus = {
    RECON_MANTIDO: 'MANTIDO_CORRETO',
    RECON_ENTRADA_INCORPORADA: 'ENTRADA_INCORPORADA',
    RECON_ENTRADA_NAO_INCORPORADA: 'ENTRADA_NAO_INCORPORADA',
    RECON_ENTRADA_SEM_AQUISICAO: 'ENTRADA_SEM_AQUISICAO',
    RECON_SAIDA_REFLETIDA: 'SAIDA_REFLETIDA',
    RECON_SAIDA_SEM_LIQUIDACAO: 'SAIDA_SEM_LIQUIDACAO',
    RECON_LIQUIDADO_NO_ESTOQUE: 'LIQUIDADO_AINDA_NO_ESTOQUE',
    RECON_LIQUIDACAO_PARCIAL: 'LIQUIDACAO_PARCIAL_SALDO',
    RECON_LIQUIDACAO_REPETIDA: 'LIQUIDACAO_REPETIDA_MESMO_DIA',
    RECON_DIVERGENCIA_VALOR: 'DIVERGENCIA_VALOR',
  }
  const reconciliation = reconSpecs.map(([scenarioId, note, inD2, inD1, acquisition, liquidations]) => ({
    scenarioId,
    identity: `V2-${scenarioId}`,
    note,
    inD2,
    inD1,
    acquisition,
    liquidations,
    valueD2: note.value,
    valueD1: scenarioId === 'RECON_DIVERGENCIA_VALOR' ? Number((note.value + 321.45).toFixed(2)) : note.value,
    expectedStatus: expectedStatus[scenarioId],
  }))

  return {
    version: DATASET_VERSION,
    baseDate: BASE_DATE,
    timezone: TIMEZONE,
    dates: BUSINESS_DATES,
    funds: [FUNDS.main, FUNDS.adversarial],
    mainFund: FUNDS.main,
    adversarialFund: FUNDS.adversarial,
    cedents,
    debtors,
    notes,
    mainNotes,
    adversarialNotes,
    operations,
    riskCandidateOperation,
    boletoDocuments,
    matching,
    reconciliation,
  }
}

export function authSpecsV2() {
  const dataset = buildGoldenV2()
  return [
    { key: 'actor', role: 'gestor', name: 'QA RLX V2 SISTEMA' },
    ...dataset.cedents.map((item) => ({ key: item.userKey, role: 'cedente', name: item.name })),
    ...dataset.debtors.map((item) => ({ key: item.userKey, role: 'sacado', name: item.name })),
  ].map((item) => ({ ...item, email: `${item.key}@qa-rlx-v2.invalid` }))
}
