import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

export const SEED_VERSION = 'CENTRAL_LOGISTICA_QA_V1'
export const SEED_CONFIRMATION = 'SEED_CENTRAL_LOGISTICA_HOMOLOG'
export const CLEANUP_CONFIRMATION = 'CLEANUP_CENTRAL_LOGISTICA_HOMOLOG'
export const FUND_NAME = 'QA CENTRAL LOGISTICA FIDC'
export const QA_EMAIL_DOMAIN = 'qa-logistica.invalid'

export function parseArgs(argv = process.argv.slice(2)) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s)
    const next = argv[index + 1]
    if (inlineValue !== undefined) result[rawKey] = inlineValue
    else if (next && !next.startsWith('--')) {
      result[rawKey] = next
      index += 1
    } else result[rawKey] = true
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
  const userMatch = decodeURIComponent(url.username).match(/^postgres[.]([a-z0-9]+)$/i)
  if (userMatch) return userMatch[1]
  const directMatch = url.hostname.match(/^db[.]([a-z0-9]+)[.]supabase[.]co$/i)
  return directMatch?.[1] ?? null
}

function productionRefs() {
  const path = resolve(process.cwd(), '.env.producao')
  if (!existsSync(path)) return new Set()
  const refs = new Set()
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^(?:NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL)=(.*)$/)
    if (!match) continue
    try {
      const url = new URL(normalizeEnvValue(match[1]))
      if (url.hostname.endsWith('.supabase.co')) refs.add(url.hostname.split('.')[0])
    } catch {
      // Um arquivo de producao malformado nao reduz as demais travas de homologacao.
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
  const expectedRef = String(args['expected-project-ref'] || process.env.LOGISTICA_HOMOLOG_PROJECT_REF || '').trim()

  if (!['homolog', 'homologacao'].includes(appEnv)) {
    throw new Error(`Ambiente bloqueado: NEXT_PUBLIC_APP_ENV precisa ser homolog; recebido "${appEnv || 'ausente'}".`)
  }
  if (nodeEnv === 'production') throw new Error('Ambiente bloqueado: NODE_ENV=production.')
  if (!supabaseUrl || !serviceRoleKey || !dbUrl) {
    throw new Error('Homologacao exige URL Supabase, service role e SUPABASE_DB_URL/DATABASE_URL em .env.homolog.')
  }
  if (!expectedRef) {
    throw new Error('Informe LOGISTICA_HOMOLOG_PROJECT_REF ou --expected-project-ref para provar o projeto de homologacao.')
  }

  const apiUrl = new URL(supabaseUrl)
  const apiRef = apiUrl.hostname.split('.')[0]
  const dbRef = projectRefFromDbUrl(dbUrl)
  if (apiUrl.protocol !== 'https:' || !apiUrl.hostname.endsWith('.supabase.co')) throw new Error('URL Supabase nao reconhecida.')
  if (apiRef !== expectedRef || dbRef !== expectedRef) {
    throw new Error(`Projeto bloqueado: referencias API/DB nao coincidem com a referencia homolog esperada (${expectedRef}).`)
  }
  if (productionRefs().has(expectedRef)) throw new Error('Projeto bloqueado: a referencia informada aparece em .env.producao.')

  return { appEnv, supabaseUrl, serviceRoleKey, dbUrl, projectRef: expectedRef }
}

export function assertMutation(args, confirmation) {
  if (args.apply !== true) return false
  if (args.confirm !== confirmation) throw new Error(`Confirmacao invalida. Informe exatamente --confirm ${confirmation}.`)
  return true
}

export function deterministicUuid(key) {
  const hex = createHash('md5').update(`BW_ANTECIPA:${SEED_VERSION}:${key}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function sha256(key) {
  return createHash('sha256').update(`${SEED_VERSION}:${key}`).digest('hex')
}

export function dateInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = (type) => parts.find((item) => item.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function timestamp(dateString, hour = 12) {
  return `${dateString}T${String(hour).padStart(2, '0')}:00:00-03:00`
}

export function createAdminClient(env) {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

export async function connectDb(env, label) {
  const client = new pg.Client({
    connectionString: env.dbUrl,
    application_name: `bw_antecipa_logistica_qa_${label}`,
    statement_timeout: 180_000,
    query_timeout: 180_000,
    ssl: { rejectUnauthorized: false },
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
    { key: 'actor', email: `actor@${QA_EMAIL_DOMAIN}`, role: 'gestor', name: 'QA Logistica Sistema' },
    ...Array.from({ length: 3 }, (_, index) => ({
      key: `cedente-${index + 1}`, email: `cedente-${index + 1}@${QA_EMAIL_DOMAIN}`,
      role: 'cedente', name: `QA LOGISTICA CEDENTE ${String.fromCharCode(65 + index)}`,
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      key: `sacado-${index + 1}`, email: `sacado-${index + 1}@${QA_EMAIL_DOMAIN}`,
      role: 'sacado', name: `QA LOGISTICA SACADO ${String(index + 1).padStart(2, '0')}`,
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
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email: spec.email,
        password: randomBytes(32).toString('base64url'),
        email_confirm: true,
        user_metadata: { qa_dataset: SEED_VERSION, synthetic: true },
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
  for (const id of ids.reverse()) await admin.auth.admin.deleteUser(id).catch(() => undefined)
}

export function localManifestPath() {
  const root = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'homologacao', 'central-logistica')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  return resolve(root, 'manifest.json')
}

export function writeRestrictedJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(path, 0o600) } catch { /* Windows nao aplica modos POSIX. */ }
}

export async function insertRows(client, table, columns, rows, options = {}) {
  if (!rows.length) return 0
  const values = []
  const tuples = rows.map((row) => `(${columns.map((column) => {
    values.push(row[column] ?? null)
    return `$${values.length}`
  }).join(', ')})`)
  const conflict = options.conflict || 'ON CONFLICT DO NOTHING'
  const sql = `INSERT INTO public.${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')} ${conflict}`
  const result = await client.query(sql, values)
  return result.rowCount || 0
}

export function buildDataset(today = dateInSaoPaulo()) {
  const fund = { id: deterministicUuid('fund'), name: FUND_NAME, cnpj: '99.900.000/0001-01' }
  const policies = [1, 2].map((number) => ({
    id: deterministicUuid(`policy-${number}`), versionId: deterministicUuid(`policy-${number}-v1`),
    code: `QA_LOGISTICA_${number === 1 ? 'SEM_GATE' : 'COM_GATE'}`,
    name: `QA Logistica - ${number === 1 ? 'sem' : 'com'} gate pre-cessao`, gate: number === 2,
    reqCteId: deterministicUuid(`policy-${number}-req-cte`), reqProofId: deterministicUuid(`policy-${number}-req-proof`),
  }))
  const cedents = Array.from({ length: 3 }, (_, index) => ({
    id: deterministicUuid(`cedent-${index + 1}`), linkId: deterministicUuid(`cedent-link-${index + 1}`),
    name: `QA LOGISTICA CEDENTE ${String.fromCharCode(65 + index)}`,
    cnpj: `99900000000${String(index + 1).padStart(3, '0')}`.slice(-14),
    policy: index === 2 ? policies[1] : policies[0],
    assignmentId: deterministicUuid(`cedent-policy-${index + 1}`),
  }))
  const debtors = Array.from({ length: 6 }, (_, index) => ({
    id: deterministicUuid(`debtor-${index + 1}`), name: `QA LOGISTICA SACADO ${String(index + 1).padStart(2, '0')}`,
    cnpj: `99800000000${String(index + 1).padStart(3, '0')}`.slice(-14),
  }))
  const values = [8500, 17250, 32000, 48750, 75000, 94752.52, 125000, 240000, 480000]
  const notes = Array.from({ length: 60 }, (_, offset) => {
    const number = offset + 1
    const cedentIndex = Math.floor(offset / 20)
    const local = (offset % 20) + 1
    const cedent = cedents[cedentIndex]
    const debtor = debtors[offset % debtors.length]
    let target = 'INDETERMINADA'
    if (cedentIndex === 2) target = local <= 10 ? 'ENTREGUE' : local <= 18 ? 'EM_TRANSITO' : 'INDETERMINADA'
    else target = local <= 5 ? 'ENTREGUE' : local <= 11 ? 'EM_TRANSITO' : 'INDETERMINADA'
    const hasOperation = local <= 18
    const operationNumber = hasOperation ? cedentIndex * 6 + Math.ceil(local / 3) : null
    const operationId = operationNumber ? deterministicUuid(`operation-${operationNumber}`) : null
    const gate = cedent.policy.gate
    let creation = 'INDETERMINADA'
    if (target === 'ENTREGUE') {
      if (gate && number % 2 === 1) creation = 'ENTREGUE'
      else if (number % 4 === 0) creation = 'ENTREGUE'
      else if (number % 4 === 2 && !gate) creation = 'INDETERMINADA'
      else creation = 'EM_TRANSITO'
    } else if (target === 'EM_TRANSITO') creation = number % 3 === 0 && !gate ? 'INDETERMINADA' : 'EM_TRANSITO'
    const approval = target === 'ENTREGUE' && number % 4 === 3 ? 'ENTREGUE'
      : target === 'ENTREGUE' || target === 'EM_TRANSITO' ? 'EM_TRANSITO' : 'INDETERMINADA'
    return {
      id: deterministicUuid(`nf-${number}`), number, numberText: `QA${String(number).padStart(6, '0')}`,
      key: String(70_000_000_000_000_000_000_000_000_000_000_000_000_000_000n + BigInt(number)),
      cedent, debtor, target, creation, approval,
      operationNumber, operationId, value: values[offset % values.length],
      issueDate: addDays(today, -(45 + (number % 25))), dueDate: addDays(today, (number % 45) - 12),
    }
  })
  const operationStatuses = ['solicitada', 'solicitada', 'solicitada', 'solicitada', 'aprovada', 'aprovada', 'aprovada',
    'em_andamento', 'em_andamento', 'em_andamento', 'em_andamento', 'em_andamento', 'em_andamento', 'em_andamento',
    'liquidada', 'liquidada', 'liquidada', 'liquidada']
  const cessionOffsets = [-30, -20, -15, -10, -9, -7, -3, 0]
  const operations = Array.from({ length: 18 }, (_, offset) => {
    const number = offset + 1
    const related = notes.filter((note) => note.operationNumber === number)
    const cedent = related[0].cedent
    const status = operationStatuses[offset]
    const hasCession = ['em_andamento', 'liquidada'].includes(status)
    const cessionDate = hasCession ? addDays(today, cessionOffsets[offset % cessionOffsets.length]) : null
    const createdDate = cessionDate ? addDays(cessionDate, -5) : addDays(today, -(offset % 12))
    return {
      id: deterministicUuid(`operation-${number}`), number, cedent, policy: cedent.policy, status,
      notes: related, cessionDate, createdAt: timestamp(createdDate, 9),
      approvedAt: status === 'solicitada' ? null : timestamp(addDays(createdDate, 2), 14),
      gross: related.reduce((sum, note) => sum + note.value, 0),
      dueDate: [...related].sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0].dueDate,
    }
  })

  const sharedAssignments = [
    { key: 'shared-1', notes: [6, 7, 8], pattern: 'approved' },
    { key: 'shared-2', notes: [25, 26, 27, 28, 29], pattern: 'approved_pending' },
    { key: 'shared-3', notes: [12, 13, 14, 15], pattern: 'pending' },
    { key: 'shared-4', notes: [21, 22, 23, 24], pattern: 'rejected_approved' },
  ]
  const assignedCte = new Set(sharedAssignments.flatMap((item) => item.notes))
  const cteGroups = sharedAssignments.map((item) => ({ ...item, notes: item.notes.map((number) => notes[number - 1]) }))
  for (const note of notes) {
    const needsCte = note.target === 'EM_TRANSITO'
      || (note.target === 'ENTREGUE' && note.number % 2 === 0)
      || (note.target === 'INDETERMINADA' && note.number % 4 < 2)
    if (!needsCte || assignedCte.has(note.number)) continue
    const pattern = note.target === 'INDETERMINADA'
      ? (note.number % 2 ? 'rejected' : 'rejected_pending')
      : (note.number % 5 === 0 ? 'approved_pending' : 'approved')
    cteGroups.push({ key: `individual-${note.number}`, notes: [note], pattern })
  }
  const proofGroups = notes.filter((note) => (
    note.target === 'ENTREGUE'
    || (note.target === 'INDETERMINADA' && note.number % 3 === 0)
    || note.target === 'EM_TRANSITO'
  ) && ![27, 52].includes(note.number))
    .map((note) => ({
      key: `proof-${note.number}`, notes: [note],
      pattern: note.target === 'ENTREGUE'
        ? (note.number % 7 === 0 ? 'approved_pending' : note.number % 6 === 0 ? 'rejected_approved' : 'approved')
        : (note.number % 2 ? 'rejected' : 'pending'),
    }))
  const documents = [
    ...cteGroups.map((group, index) => ({ ...group, family: 'cte', index: index + 1 })),
    ...proofGroups.map((group, index) => ({ ...group, family: 'comprovante_entrega', index: index + 1 })),
  ].map((doc) => {
    const note = doc.notes[0]
    const operation = note.operationId ? operations.find((item) => item.id === note.operationId) : null
    const cession = operation?.cessionDate
    const anticipated = doc.family === 'cte' ? doc.index % 3 !== 0 : doc.index % 4 === 0
    const uploadDate = cession
      ? addDays(cession, anticipated ? -((doc.index % 10) + 1) : [0, 1, 4, 9, 15][doc.index % 5])
      : addDays(today, -(doc.index % 10))
    const versionCount = doc.pattern.includes('_') ? 2 : 1
    const statuses = doc.pattern === 'rejected_approved' ? ['rejeitado', 'aprovado']
      : doc.pattern === 'rejected_pending' ? ['rejeitado', 'em_analise']
        : doc.pattern === 'approved_pending' ? ['aprovado', 'em_analise']
          : doc.pattern === 'approved' ? ['aprovado'] : doc.pattern === 'rejected' ? ['rejeitado'] : ['em_analise']
    const id = deterministicUuid(`document-${doc.family}-${doc.key}`)
    const versions = Array.from({ length: versionCount }, (_, index) => ({
      id: deterministicUuid(`document-version-${doc.family}-${doc.key}-${index + 1}`), number: index + 1,
      status: statuses[index], uploadedAt: timestamp(addDays(uploadDate, index), 11 + index),
      analysis: statuses[index] === 'em_analise' ? null : statuses[index],
    }))
    return { ...doc, id, versions, currentVersion: versions.at(-1), uploadDate, anticipated }
  })
  const documentsByNote = new Map(notes.map((note) => [note.number, documents.filter((doc) => doc.notes.some((item) => item.number === note.number))]))
  const proofByNote = new Map(documents.filter((doc) => doc.family === 'comprovante_entrega').map((doc) => [doc.notes[0].number, doc]))
  const cteByNote = new Map()
  for (const doc of documents.filter((item) => item.family === 'cte')) for (const note of doc.notes) cteByNote.set(note.number, doc)

  return { today, fund, policies, cedents, debtors, notes, operations, documents, documentsByNote, proofByNote, cteByNote }
}

export function environmentSummary(env) {
  return `Ambiente: ${env.appEnv}\nProjeto homolog: ${env.projectRef}\nHost: ${new URL(env.supabaseUrl).host}`
}

export function brl(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}
