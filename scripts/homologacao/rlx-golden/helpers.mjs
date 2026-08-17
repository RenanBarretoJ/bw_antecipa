import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

export const DATASET_VERSION = 'RLX_GOLDEN_V1'
export const BASE_DATE = '2026-08-10'
export const TIMEZONE = 'America/Sao_Paulo'
export const MAIN_FUND_NAME = 'QA RLX GOLDEN FIDC'
export const ADVERSARIAL_FUND_NAME = 'QA RLX GOLDEN ADVERSARIAL FIDC'
export const QA_EMAIL_DOMAIN = 'qa-rlx.invalid'
export const BOLETO_DOCUMENT_CODE = 'boleto_duplicata_digital'

export function parseArgs(argv = process.argv.slice(2)) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const [key, inlineValue] = arg.slice(2).split(/=(.*)/s)
    const next = argv[index + 1]
    if (inlineValue !== undefined) result[key] = inlineValue
    else if (next && !next.startsWith('--')) {
      result[key] = next
      index += 1
    } else result[key] = true
  }
  return result
}

function normalizeEnvValue(rawValue) {
  const value = rawValue.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

export function loadHomologEnv() {
  if (process.env.BW_CLEAN_ROOM_E2E === '1') {
    return { path: null, loaded: {}, cleanRoom: true }
  }
  const path = resolve(process.cwd(), '.env.homolog')
  if (!existsSync(path)) throw new Error('.env.homolog nao encontrado. A execucao foi bloqueada.')
  const loaded = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    loaded[match[1]] = normalizeEnvValue(match[2])
    if (process.env[match[1]] === undefined) process.env[match[1]] = loaded[match[1]]
  }
  return { path, loaded }
}

function projectRefFromDbUrl(dbUrl) {
  const url = new URL(dbUrl)
  const pooler = decodeURIComponent(url.username).match(/^postgres[.]([a-z0-9]+)$/i)
  if (pooler) return pooler[1]
  return url.hostname.match(/^db[.]([a-z0-9]+)[.]supabase[.]co$/i)?.[1] ?? null
}

function productionRefs() {
  const refs = new Set()
  for (const file of ['.env.producao', '.env.production']) {
    const path = resolve(process.cwd(), file)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.trim().match(/^(?:NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL)=(.*)$/)
      if (!match) continue
      try {
        const url = new URL(normalizeEnvValue(match[1]))
        if (url.hostname.endsWith('.supabase.co')) refs.add(url.hostname.split('.')[0])
      } catch {
        // Um arquivo invalido nunca relaxa as demais protecoes.
      }
    }
  }
  return refs
}

export function assertHomologEnvironment(args = {}) {
  const appEnv = String(process.env.NEXT_PUBLIC_APP_ENV || '').trim().toLowerCase()
  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase()
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
  const expectedRef = String(args['expected-project-ref'] || process.env.RLX_GOLDEN_HOMOLOG_PROJECT_REF || '').trim()

  if (process.env.BW_CLEAN_ROOM_E2E === '1') {
    if (!supabaseUrl || !serviceRoleKey || !dbUrl) {
      throw new Error('Clean-room exige URL Supabase, service role e DB URL locais.')
    }
    if (!expectedRef) throw new Error('Informe --expected-project-ref para identificar o clean-room descartavel.')
    const apiUrl = new URL(supabaseUrl)
    const databaseUrl = new URL(dbUrl)
    const localHosts = new Set(['127.0.0.1', 'localhost', '::1'])
    if (!localHosts.has(apiUrl.hostname) || !localHosts.has(databaseUrl.hostname)) {
      throw new Error('Clean-room bloqueado: API e banco devem apontar exclusivamente para localhost.')
    }
    if (nodeEnv === 'production') throw new Error('Clean-room bloqueado: NODE_ENV=production.')
    return {
      appEnv: 'clean-room', supabaseUrl, serviceRoleKey, dbUrl,
      projectRef: expectedRef, cleanRoom: true,
    }
  }

  if (!['homolog', 'homologacao'].includes(appEnv)) {
    throw new Error(`Ambiente bloqueado: NEXT_PUBLIC_APP_ENV precisa ser homolog; recebido "${appEnv || 'ausente'}".`)
  }
  if (nodeEnv === 'production') throw new Error('Ambiente bloqueado: NODE_ENV=production.')
  if (!supabaseUrl || !serviceRoleKey || !dbUrl) {
    throw new Error('Homologacao exige URL Supabase, service role e SUPABASE_DB_URL/DATABASE_URL em .env.homolog.')
  }
  if (!expectedRef) throw new Error('Informe --expected-project-ref para provar o projeto de homologacao.')

  const apiUrl = new URL(supabaseUrl)
  const apiRef = apiUrl.hostname.split('.')[0]
  const dbRef = projectRefFromDbUrl(dbUrl)
  if (apiUrl.protocol !== 'https:' || !apiUrl.hostname.endsWith('.supabase.co')) throw new Error('URL Supabase nao reconhecida.')
  if (apiRef !== expectedRef || dbRef !== expectedRef) {
    throw new Error(`Projeto bloqueado: referencias API/DB nao coincidem com homolog (${expectedRef}).`)
  }
  if (productionRefs().has(expectedRef)) throw new Error('Projeto bloqueado: a referencia informada pertence a producao.')
  return { appEnv, supabaseUrl, serviceRoleKey, dbUrl, projectRef: expectedRef }
}

export function mutationConfirmation(action, projectRef) {
  return `${action}_RLX_GOLDEN_HOMOLOG_${projectRef}`
}

export function assertMutation(args, action, projectRef) {
  if (args.execute !== true) return false
  const expected = mutationConfirmation(action, projectRef)
  if (args.confirm !== expected) throw new Error(`Confirmacao invalida. Informe exatamente --confirm ${expected}.`)
  return true
}

export function deterministicUuid(key) {
  const hex = createHash('md5').update(`BW_ANTECIPA:${DATASET_VERSION}:${key}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function sha256(value) {
  return createHash('sha256').update(`${DATASET_VERSION}:${value}`).digest('hex')
}

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function timestamp(dateString, hour = 12, minute = 0) {
  return `${dateString}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-03:00`
}

export function cnpjDigits(base12) {
  const base = String(base12).replace(/\D/g, '').padStart(12, '0').slice(-12)
  const digit = (digits, weights) => {
    const sum = [...digits].reduce((total, item, index) => total + Number(item) * weights[index], 0)
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }
  const first = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const second = digit(`${base}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${base}${first}${second}`
}

export function nfeCheckDigit(base43) {
  let weight = 2
  let sum = 0
  for (let index = base43.length - 1; index >= 0; index -= 1) {
    sum += Number(base43[index]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const value = 11 - (sum % 11)
  return value === 10 || value === 11 ? 0 : value
}

export function nfeKey({ cnpj, number, seed = number }) {
  const base = `35${BASE_DATE.slice(2, 4)}${BASE_DATE.slice(5, 7)}${cnpj}55${String((seed % 998) + 1).padStart(3, '0')}${String(number).padStart(9, '0')}1${String(10_000_000 + seed).slice(-8)}`
  if (base.length !== 43) throw new Error(`Base NF-e invalida: ${base.length}`)
  return `${base}${nfeCheckDigit(base)}`
}

export function cteKey({ cnpj, number, seed = number }) {
  const base = `35${BASE_DATE.slice(2, 4)}${BASE_DATE.slice(5, 7)}${cnpj}57${String((seed % 998) + 1).padStart(3, '0')}${String(number).padStart(9, '0')}1${String(20_000_000 + seed).slice(-8)}`
  if (base.length !== 43) throw new Error(`Base CT-e invalida: ${base.length}`)
  return `${base}${nfeCheckDigit(base)}`
}

export function validateNfeKey(key) {
  return /^\d{44}$/.test(key) && nfeCheckDigit(key.slice(0, 43)) === Number(key[43])
}

export function createAdminClient(env) {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

export async function connectDb(env, label) {
  const dbUrl = new URL(env.dbUrl)
  const local = ['127.0.0.1', 'localhost', '::1'].includes(dbUrl.hostname)
  const client = new pg.Client({
    connectionString: env.dbUrl,
    application_name: `bw_antecipa_rlx_golden_${label}`,
    statement_timeout: 240_000,
    query_timeout: 240_000,
    ssl: local ? false : { rejectUnauthorized: false },
  })
  await client.connect()
  return client
}

export async function listAllAuthUsers(admin) {
  const users = []
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`Falha ao listar usuarios Auth: ${error.message}`)
    users.push(...data.users)
    if (data.users.length < 1000) return users
  }
}

export function authSpecs() {
  return [
    { key: 'actor', email: `actor@${QA_EMAIL_DOMAIN}`, role: 'gestor', name: 'QA RLX SISTEMA' },
    ...Array.from({ length: 7 }, (_, index) => ({
      key: `cedente-${index + 1}`, email: `cedente-${index + 1}@${QA_EMAIL_DOMAIN}`,
      role: 'cedente', name: `QA RLX CEDENTE ${String(index + 1).padStart(2, '0')}`,
    })),
    ...Array.from({ length: 12 }, (_, index) => ({
      key: `sacado-${index + 1}`, email: `sacado-${index + 1}@${QA_EMAIL_DOMAIN}`,
      role: 'sacado', name: `QA RLX SACADO ${String(index + 1).padStart(2, '0')}`,
    })),
  ]
}

export async function ensureAuthUsers(admin) {
  const existing = await listAllAuthUsers(admin)
  const byEmail = new Map(existing.map((user) => [String(user.email).toLowerCase(), user]))
  const users = new Map()
  const createdIds = []
  for (const spec of authSpecs()) {
    let user = byEmail.get(spec.email)
    if (user && (user.user_metadata?.qa_dataset !== DATASET_VERSION || user.user_metadata?.synthetic !== true)) {
      throw new Error(`Colisao Auth: ${spec.email} existe sem o metadata sintetico ${DATASET_VERSION}.`)
    }
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email: spec.email,
        password: randomBytes(32).toString('base64url'),
        email_confirm: true,
        user_metadata: { qa_dataset: DATASET_VERSION, synthetic: true },
      })
      if (error || !data.user) throw new Error(`Falha ao criar usuario sintetico ${spec.key}: ${error?.message || 'retorno vazio'}`)
      user = data.user
      createdIds.push(user.id)
    }
    users.set(spec.key, { ...spec, id: user.id })
  }
  return { users, createdIds }
}

export async function removeCreatedAuthUsers(admin, ids) {
  for (const id of [...ids].reverse()) await admin.auth.admin.deleteUser(id).catch(() => undefined)
}

export async function insertRows(client, table, columns, rows, options = {}) {
  if (!rows.length) return 0
  let count = 0
  const batchSize = options.batchSize || 100
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize)
    const values = []
    const tuples = batch.map((row) => `(${columns.map((column) => {
      values.push(row[column] ?? null)
      return `$${values.length}`
    }).join(', ')})`)
    const conflict = options.conflict || 'ON CONFLICT DO NOTHING'
    try {
      const result = await client.query(`INSERT INTO public.${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')} ${conflict}`, values)
      count += result.rowCount || 0
    } catch (error) {
      const detail = error && typeof error === 'object' && 'detail' in error && error.detail ? `; ${error.detail}` : ''
      throw new Error(`Falha ao inserir public.${table} (lote ${start + 1}-${start + batch.length}): ${error instanceof Error ? error.message : String(error)}${detail}`, { cause: error })
    }
  }
  return count
}

export function localManifestPath() {
  const root = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'homologacao', 'rlx-golden')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  return resolve(root, 'manifest.json')
}

export function writeRestrictedJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(path, 0o600) } catch { /* Windows nao aplica modos POSIX. */ }
}

function makeFund(key, name, base) {
  return {
    key, id: deterministicUuid(`fund-${key}`), name, cnpj: cnpjDigits(base),
    policyId: deterministicUuid(`policy-${key}`), policyVersionId: deterministicUuid(`policy-${key}-v1`),
    policyCode: `QA_RLX_${key.toUpperCase()}_NF`,
    requirementIds: {
      xml: deterministicUuid(`policy-${key}-req-xml`),
      danfe: deterministicUuid(`policy-${key}-req-danfe`),
      boleto: deterministicUuid(`policy-${key}-req-boleto`),
      cte: deterministicUuid(`policy-${key}-req-cte`),
      proof: deterministicUuid(`policy-${key}-req-proof`),
    },
  }
}

export function buildDataset() {
  const funds = [
    makeFund('main', MAIN_FUND_NAME, '839100000001'),
    makeFund('adversarial', ADVERSARIAL_FUND_NAME, '839100000002'),
  ]
  const mainFund = funds[0]
  const adversarialFund = funds[1]
  const cedents = Array.from({ length: 7 }, (_, index) => {
    const fund = index < 5 ? mainFund : adversarialFund
    return {
      id: deterministicUuid(`cedent-${index + 1}`), userKey: `cedente-${index + 1}`,
      linkId: deterministicUuid(`cedent-${index + 1}-fund-${fund.key}`), fund,
      assignmentId: deterministicUuid(`cedent-${index + 1}-policy`),
      cnpj: cnpjDigits(`8392${String(index + 1).padStart(8, '0')}`),
      name: `QA RLX CEDENTE ${String(index + 1).padStart(2, '0')}`,
    }
  })
  const debtors = Array.from({ length: 12 }, (_, index) => ({
    id: deterministicUuid(`debtor-${index + 1}`), userKey: `sacado-${index + 1}`,
    cnpj: cnpjDigits(`8393${String(index + 1).padStart(8, '0')}`),
    name: `QA RLX SACADO ${String(index + 1).padStart(2, '0')}`,
  }))
  const noteSpecs = [
    { fund: mainFund, count: 108, cedents: cedents.slice(0, 5), offset: 0 },
    { fund: adversarialFund, count: 15, cedents: cedents.slice(5), offset: 108 },
  ]
  const values = [12500, 18750, 25000, 31500, 48750, 65000, 94752.52, 125000, 180000, 240000]
  const notes = noteSpecs.flatMap(({ fund, count, cedents: scopedCedents, offset }) => Array.from({ length: count }, (_, localIndex) => {
    const index = offset + localIndex + 1
    const cedent = scopedCedents[localIndex % scopedCedents.length]
    const debtor = debtors[(index * 5) % debtors.length]
    const value = values[index % values.length] + (index % 17) * 13.37
    const logistics = localIndex < Math.round(count * 0.4)
      ? 'ENTREGUE'
      : localIndex < Math.round(count * 0.8) ? 'EM_TRANSITO' : 'INDETERMINADA'
    const boletoScenario = ['COERENTE', 'COERENTE', 'COERENTE', 'DIVERGENCIA_VALOR', 'DIVERGENCIA_DATA', 'DIVERGENCIA_SACADO', 'DIVERGENCIA_BENEFICIARIO', 'PENDENTE', 'REJEITADO', 'AUSENTE'][index % 10]
    return {
      index, localIndex: localIndex + 1, id: deterministicUuid(`note-${fund.key}-${localIndex + 1}`), fund, cedent, debtor,
      number: `${fund.key === 'main' ? '8' : '9'}${String(localIndex + 1).padStart(8, '0')}`,
      key: nfeKey({ cnpj: cedent.cnpj, number: localIndex + 1, seed: index }),
      issueDate: addDays(BASE_DATE, -65 + (index % 25)), dueDate: addDays(BASE_DATE, 20 + (index % 95)),
      value: Number(value.toFixed(2)), logistics, boletoScenario,
      seuNumero: localIndex === 0 ? 'QA-000001' : `QA-${fund.key === 'main' ? 'M' : 'A'}-${String(localIndex + 1).padStart(6, '0')}`,
      externalReceivableId: localIndex === 0 ? '900719925474099312345' : `${fund.key === 'main' ? '91' : '92'}${String(localIndex + 1).padStart(19, '0')}`,
    }
  }))
  const mainNotes = notes.filter((note) => note.fund === mainFund)
  // O gate logistico pre-cessao exige evidencia aprovada: D0 usa apenas
  // NFs ENTREGUE ou EM_TRANSITO, nunca o grupo INDETERMINADA.
  const operationNotes = [0, 10, 20, 30, 40, 45, 55, 65, 75, 85].map((index) => mainNotes[index])
  const operations = operationNotes.map((note, index) => ({
    id: deterministicUuid(`operation-${index + 1}`), number: index + 1, note,
    rate: [1.49, 1.79, 1.99, 2.19, 2.49][index % 5],
    createdAt: timestamp(BASE_DATE, 9 + Math.floor(index / 4), (index * 7) % 60),
    approvedAt: timestamp(BASE_DATE, 12 + Math.floor(index / 5), (index * 11) % 60),
  }))
  const operationByNote = new Map(operations.map((operation) => [operation.note.id, operation]))
  for (const note of notes) note.operation = operationByNote.get(note.id) || null

  const documents = []
  for (const note of notes) {
    const push = (family, status, extra = {}) => {
      const key = `${note.fund.key}-${note.localIndex}-${family}`
      documents.push({
        id: deterministicUuid(`document-${key}`), versionId: deterministicUuid(`document-${key}-v1`),
        family, note, status, uploadedAt: timestamp(addDays(BASE_DATE, -4 + (note.index % 4)), 10, note.index % 60), ...extra,
      })
    }
    push('nf_xml', 'aprovado')
    if (note.index % 9 !== 0) push('nf_danfe_pdf', 'aprovado')
    if (note.boletoScenario !== 'AUSENTE') {
      push('boleto', note.boletoScenario === 'REJEITADO' ? 'rejeitado' : note.boletoScenario === 'PENDENTE' ? 'em_analise' : 'aprovado', {
        evidence: {
          numero: `BOL-${note.number}`, beneficiarioCnpj: note.boletoScenario === 'DIVERGENCIA_BENEFICIARIO' ? debtors[0].cnpj : note.cedent.cnpj,
          pagadorCnpj: note.boletoScenario === 'DIVERGENCIA_SACADO' ? debtors[1].cnpj : note.debtor.cnpj,
          valor: note.boletoScenario === 'DIVERGENCIA_VALOR' ? Number((note.value + 125.41).toFixed(2)) : note.value,
          vencimento: note.boletoScenario === 'DIVERGENCIA_DATA' ? addDays(note.dueDate, 3) : note.dueDate,
          linhaDigitavel: null, codigoBarras: null, synthetic: true,
        },
      })
    }
    if (note.logistics === 'ENTREGUE' || note.logistics === 'EM_TRANSITO') push('cte_xml', 'aprovado')
    if (note.logistics === 'ENTREGUE') push('comprovante_entrega', 'aprovado')
    if (note.logistics === 'INDETERMINADA' && note.index % 3 === 0) push('cte_xml', 'rejeitado')
  }
  const documentByNoteFamily = new Map(documents.map((document) => [`${document.note.id}:${document.family}`, document]))
  const operationNoteIds = new Set(operationNotes.map((note) => note.id))
  const stockD1 = mainNotes.filter((note) => !operationNoteIds.has(note.id)).slice(0, 90)
  const acquisitions = mainNotes.slice(73, 103).map((note, index) => ({
    note, date: addDays(BASE_DATE, index % 2 === 0 ? -3 : -2), value: Number((note.value * (0.94 + (index % 4) * 0.005)).toFixed(2)),
    revision: index === 6 ? 2 : 1,
  }))
  const liquidations = mainNotes.slice(8, 31).flatMap((note, index) => {
    const base = [{ note, date: addDays(BASE_DATE, index % 2 === 0 ? -3 : -1), value: Number((note.value * (index % 5 === 0 ? 0.4 : 1)).toFixed(2)), code: index % 5 === 0 ? 'MOV_PARTIAL' : 'MOV_FULL' }]
    if (index === 5) base.push({ note, date: addDays(BASE_DATE, -1), value: Number((note.value * 0.25).toFixed(2)), code: 'MOV_PARTIAL' })
    return base
  })
  return {
    version: DATASET_VERSION, baseDate: BASE_DATE, timezone: TIMEZONE,
    funds, mainFund, adversarialFund, cedents, debtors, notes, mainNotes, operations, documents,
    documentByNoteFamily, stockD1, acquisitions, liquidations,
  }
}

export function environmentSummary(env) {
  return `Ambiente: ${env.appEnv}; projeto: ${env.projectRef}; dataset: ${DATASET_VERSION}`
}
