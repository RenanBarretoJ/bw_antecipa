#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js'

const EXPECTED_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const url = required('NEXT_PUBLIC_SUPABASE_URL')
const anonKey = required('NEXT_PUBLIC_SUPABASE_ANON_KEY')
const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY')
const projectRef = new URL(url).hostname.split('.')[0]
const productionRef = required('SUPABASE_PRODUCTION_PROJECT_REF')

if (projectRef !== EXPECTED_PROJECT_REF) throw new Error(`Projeto nao autorizado: ${projectRef}.`)
if (projectRef === productionRef) throw new Error('Projeto de producao bloqueado.')

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`
const password = `P0-${crypto.randomUUID()}-Aa1!`
const createdUsers = []
const createdCedentes = []
const storagePaths = []
const checks = []

try {
  const cedenteA = await createActor('cedente', `p0-doc-a-${runId}@example.invalid`, cnpjFor(runId, 1))
  const cedenteB = await createActor('cedente', `p0-doc-b-${runId}@example.invalid`, cnpjFor(runId, 2))
  const gestor = await createActor('gestor', `p0-doc-g-${runId}@example.invalid`)
  const consultor = await createActor('consultor', `p0-doc-c-${runId}@example.invalid`)
  const sacado = await createActor('sacado', `p0-doc-s-${runId}@example.invalid`)

  const clientA = await authenticated(cedenteA.email)
  const clientB = await authenticated(cedenteB.email)
  const clientGestor = await authenticated(gestor.email)
  const clientConsultor = await authenticated(consultor.email)
  const clientSacado = await authenticated(sacado.email)
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const first = await uploadAndRegister(clientA, cedenteA.cnpj, 'contrato_social', 'contrato-social.pdf')
  const second = await uploadAndRegister(clientA, cedenteA.cnpj, 'cartao_cnpj', 'cartao-cnpj.pdf')
  assert(first.versao === 1 && second.versao === 1, 'dois tipos documentais foram registrados como versao inicial')
  assert(first.status === 'enviado' && second.status === 'enviado', 'status inicial e definido pelo backend')
  assert(await storageObjectExists(first.storage_path), 'arquivo registrado existe no Storage')

  const { data: repeated, error: repeatError } = await clientA.rpc('registrar_documento_cadastral_cedente', {
    p_tipo: 'contrato_social',
    p_storage_path: first.storage_path,
    p_nome_arquivo: 'contrato-social.pdf',
    p_representante_id: null,
  })
  if (repeatError) throw repeatError
  const repeatedRow = Array.isArray(repeated) ? repeated[0] : repeated
  assert(repeatedRow?.documento_id === first.documento_id, 'repeticao da mesma requisicao e idempotente')

  const { count: samePathCount, error: countError } = await admin
    .from('documentos')
    .select('id', { count: 'exact', head: true })
    .eq('url_arquivo', first.storage_path)
  if (countError) throw countError
  assert(samePathCount === 1, 'repeticao nao cria documento duplicado')

  const { data: ownRows, error: ownReadError } = await clientA.from('documentos').select('id').in('id', [first.documento_id, second.documento_id])
  if (ownReadError) throw ownReadError
  assert(ownRows?.length === 2, 'cedente le os proprios documentos')

  const { data: foreignRows, error: foreignReadError } = await clientB.from('documentos').select('id').in('id', [first.documento_id, second.documento_id])
  if (foreignReadError) throw foreignReadError
  assert(foreignRows?.length === 0, 'outro cedente nao le documentos alheios')

  await expectRpcDenied(clientB, first.storage_path, 'cedente de outro contexto nao registra documento alheio')
  await expectRpcDenied(clientGestor, first.storage_path, 'gestor nao escreve pela RPC do cedente')
  await expectRpcDenied(clientConsultor, first.storage_path, 'consultor nao escreve pela RPC do cedente')
  await expectRpcDenied(clientSacado, first.storage_path, 'sacado nao escreve pela RPC do cedente')
  await expectRpcDenied(anon, first.storage_path, 'anonimo nao executa a RPC')

  const compensationPath = `${cedenteA.cnpj}/representantes/${crypto.randomUUID()}/${crypto.randomUUID()}_falha.pdf`
  storagePaths.push(compensationPath)
  await uploadPdf(clientA, compensationPath)
  const { error: forcedDatabaseError } = await clientA.rpc('registrar_documento_cadastral_cedente', {
    p_tipo: 'rg_cpf',
    p_storage_path: compensationPath,
    p_nome_arquivo: 'falha.pdf',
    p_representante_id: crypto.randomUUID(),
  })
  assert(Boolean(forcedDatabaseError), 'falha SQL controlada foi produzida')
  const { error: compensationError } = await clientA.storage.from('documentos-cedentes').remove([compensationPath])
  if (compensationError) throw compensationError
  assert(!(await storageObjectExists(compensationPath)), 'falha SQL foi compensada sem objeto orfao')

  const invalidStoragePath = `00000000000000/contrato_social/${crypto.randomUUID()}_negado.pdf`
  const { error: invalidStorageError } = await clientA.storage.from('documentos-cedentes').upload(
    invalidStoragePath,
    pdfBody(),
    { contentType: 'application/pdf' },
  )
  assert(Boolean(invalidStorageError), 'Storage bloqueia caminho fora do cedente')
  const { count: invalidDbCount, error: invalidDbError } = await admin.from('documentos').select('id', { count: 'exact', head: true }).eq('url_arquivo', invalidStoragePath)
  if (invalidDbError) throw invalidDbError
  assert(invalidDbCount === 0, 'falha no Storage nao cria registro no banco')

  console.log(JSON.stringify({
    status: 'PASS',
    environment: 'homolog',
    project_ref: projectRef,
    production_touched: false,
    checks,
  }, null, 2))
} finally {
  await cleanup()
}

async function createActor(role, email, cnpj = null) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nome_completo: `P0 Documento ${role}`, role },
  })
  if (error || !data.user) throw error || new Error('Usuario sintetico nao criado.')
  createdUsers.push(data.user.id)

  const { error: profileError } = await admin.from('profiles').upsert({
    id: data.user.id,
    email,
    nome_completo: `P0 Documento ${role}`,
    role,
    status: 'ativo',
  })
  if (profileError) throw profileError

  if (role === 'cedente' && cnpj) {
    const { data: cedente, error: cedenteError } = await admin.from('cedentes').insert({
      user_id: data.user.id,
      cnpj,
      razao_social: `P0 DOCUMENTOS ${cnpj}`,
      status: 'pendente',
    }).select('id').single()
    if (cedenteError) throw cedenteError
    createdCedentes.push(cedente.id)
  }
  return { id: data.user.id, email, cnpj }
}

async function authenticated(email) {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return client
}

async function uploadAndRegister(client, cnpj, tipo, name) {
  const path = `${cnpj}/${tipo}/${crypto.randomUUID()}_${name}`
  storagePaths.push(path)
  await uploadPdf(client, path)
  const { data, error } = await client.rpc('registrar_documento_cadastral_cedente', {
    p_tipo: tipo,
    p_storage_path: path,
    p_nome_arquivo: name,
    p_representante_id: null,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('RPC nao retornou documento.')
  return row
}

async function uploadPdf(client, path) {
  const { error } = await client.storage.from('documentos-cedentes').upload(path, pdfBody(), { contentType: 'application/pdf' })
  if (error) throw error
}

async function expectRpcDenied(client, path, label) {
  const { error } = await client.rpc('registrar_documento_cadastral_cedente', {
    p_tipo: 'contrato_social',
    p_storage_path: path,
    p_nome_arquivo: 'indevido.pdf',
    p_representante_id: null,
  })
  assert(Boolean(error), label)
}

async function storageObjectExists(path) {
  const prefix = path.slice(0, path.lastIndexOf('/'))
  const filename = path.slice(path.lastIndexOf('/') + 1)
  const { data, error } = await admin.storage.from('documentos-cedentes').list(prefix, { search: filename })
  if (error) throw error
  return Boolean(data?.some((item) => item.name === filename))
}

async function cleanup() {
  if (createdCedentes.length > 0) await admin.from('documentos').delete().in('cedente_id', createdCedentes)
  if (storagePaths.length > 0) await admin.storage.from('documentos-cedentes').remove(storagePaths)
  for (const id of createdUsers.reverse()) await admin.auth.admin.deleteUser(id).catch(() => undefined)
}

function pdfBody() {
  return new Blob(['%PDF-1.4\n% P0 BW Antecipa\n'], { type: 'application/pdf' })
}

function cnpjFor(value, suffix) {
  return `${String(value).replace(/\D/g, '').slice(-12).padStart(12, '0')}${String(suffix).padStart(2, '0')}`
}

function assert(condition, label) {
  if (!condition) throw new Error(`Falha: ${label}`)
  checks.push(label)
}

function required(key) {
  const value = process.env[key]
  if (!value) throw new Error(`${key} ausente em .env.homolog.`)
  return value
}
