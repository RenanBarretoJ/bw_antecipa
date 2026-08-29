#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

loadEnv(resolve('.env.homolog'))

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
const createdFundos = []
const createdCedentes = []
const checks = []

try {
  const fundoA = await createFundo('A')
  const fundoB = await createFundo('B')

  const cedenteProprio = await createActor('cedente', `p0-doc-gestor-cedente-${runId}@example.invalid`)
  const cedenteC1 = await createCedenteAtivo(cedenteProprio.id, fundoA)

  const gestorAtivoFundoA = await createGestor('ga', fundoA, 'ativo')
  const gestorFundoB = await createGestor('gb', fundoB, 'ativo')
  const gestorVinculoRevogado = await createGestor('gc', fundoA, 'revogado')
  const superAdminPuro = await createActor('super_admin', `p0-doc-gestor-sa-${runId}@example.invalid`)
  const consultor = await createActor('consultor', `p0-doc-gestor-co-${runId}@example.invalid`)

  const clientGA = await authenticated(gestorAtivoFundoA.email)
  const clientGB = await authenticated(gestorFundoB.email)
  const clientGC = await authenticated(gestorVinculoRevogado.email)
  const clientSA = await authenticated(superAdminPuro.email)
  const clientCO = await authenticated(consultor.email)
  const clientCedente = await authenticated(cedenteProprio.email)
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const doc1 = await criarDocumento(cedenteC1.id, 'contrato_social')
  const doc2 = await criarDocumento(cedenteC1.id, 'cartao_cnpj')
  const doc3 = await criarDocumento(cedenteC1.id, 'rg_cpf')

  // DENY: papeis sem vinculo/autorizacao nenhuma
  await expectAnalisarDenied(clientGB, doc1.id, 'aprovado', undefined, 'gestor de outro fundo (sem vinculo) = DENY')
  await expectAnalisarDenied(clientGC, doc1.id, 'aprovado', undefined, 'gestor com vinculo revogado = DENY')
  await expectAnalisarDenied(clientSA, doc1.id, 'aprovado', undefined, 'super admin puro = DENY operacional')
  await expectAnalisarDenied(clientCedente, doc1.id, 'aprovado', undefined, 'cedente = DENY analise')
  await expectAnalisarDenied(clientCO, doc1.id, 'aprovado', undefined, 'consultor = DENY')
  await expectAnalisarDenied(anon, doc1.id, 'aprovado', undefined, 'anon = DENY')

  await expectSolicitarDenied(clientGB, doc1.id, 'solicitar atualizacao por gestor de outro fundo = DENY')
  await expectSolicitarDenied(clientSA, doc1.id, 'solicitar atualizacao por super admin puro = DENY')
  await expectSolicitarDenied(anon, doc1.id, 'solicitar atualizacao por anon = DENY')

  // DENY: UPDATE direto na tabela continua bloqueado mesmo para o gestor autorizado
  const { error: directUpdateError } = await clientGA.from('documentos').update({ status: 'aprovado' }).eq('id', doc1.id)
  assert(Boolean(directUpdateError) && /permission denied/i.test(directUpdateError.message), 'UPDATE direto em documentos continua DENY (permission denied)')

  // ALLOW: gestor do fundo correto aprova
  const { data: aprovado, error: aprovarError } = await clientGA.rpc('analisar_documento_gestor', {
    p_documento_id: doc1.id, p_decisao: 'aprovado', p_motivo: null,
  })
  if (aprovarError) throw aprovarError
  const aprovadoRow = Array.isArray(aprovado) ? aprovado[0] : aprovado
  assert(aprovadoRow?.status === 'aprovado', 'gestor do fundo correto aprova = ALLOW')

  // DENY: reprovar sem motivo
  const { error: semMotivoError } = await clientGA.rpc('analisar_documento_gestor', {
    p_documento_id: doc2.id, p_decisao: 'reprovado', p_motivo: null,
  })
  assert(Boolean(semMotivoError), 'reprovacao sem motivo = DENY (validacao)')

  // ALLOW: gestor do fundo correto reprova com motivo
  const { data: reprovado, error: reprovarError } = await clientGA.rpc('analisar_documento_gestor', {
    p_documento_id: doc2.id, p_decisao: 'reprovado', p_motivo: 'Documento ilegivel.',
  })
  if (reprovarError) throw reprovarError
  const reprovadoRow = Array.isArray(reprovado) ? reprovado[0] : reprovado
  assert(reprovadoRow?.status === 'reprovado', 'gestor do fundo correto reprova com motivo = ALLOW')
  const { data: doc2Check } = await admin.from('documentos').select('motivo_reprovacao, analisado_por').eq('id', doc2.id).single()
  assert(doc2Check?.motivo_reprovacao === 'Documento ilegivel.', 'motivo de reprovacao persistido')
  assert(doc2Check?.analisado_por === gestorAtivoFundoA.id, 'analisado_por registra o ator correto')

  // DENY: reanalisar documento ja decidido (transicao invalida)
  const { error: reanaliseError } = await clientGA.rpc('analisar_documento_gestor', {
    p_documento_id: doc1.id, p_decisao: 'reprovado', p_motivo: 'tentativa invalida',
  })
  assert(Boolean(reanaliseError), 'reanalisar documento ja aprovado = DENY (transicao invalida)')

  // ALLOW: gestor do fundo correto solicita atualizacao (inclusive em doc ja aprovado)
  const { data: solicitado, error: solicitarError } = await clientGA.rpc('solicitar_atualizacao_documento_gestor', {
    p_documento_id: doc1.id,
  })
  if (solicitarError) throw solicitarError
  const solicitadoRow = Array.isArray(solicitado) ? solicitado[0] : solicitado
  assert(Boolean(solicitadoRow?.atualizacao_solicitada_em), 'gestor do fundo correto solicita atualizacao = ALLOW')

  // zero cross-fund leak na leitura (policy multifundo)
  const { data: leakRows } = await clientGB.from('documentos').select('id').in('id', [doc1.id, doc2.id, doc3.id])
  assert((leakRows || []).length === 0, 'gestor de outro fundo nao le os documentos deste cedente (zero leak)')

  console.log(JSON.stringify({ status: 'PASS', environment: 'homolog', project_ref: projectRef, production_touched: false, checks }, null, 2))
} finally {
  await cleanup()
}

async function createFundo(label) {
  const { data, error } = await admin.from('fundos').insert({
    nome: `P0 Fundo Gestor ${label} ${runId}`,
    cnpj: cnpjFor(runId, label === 'A' ? 91 : 92),
    administradora_nome: 'P0 Administradora',
    administradora_cnpj: cnpjFor(runId, label === 'A' ? 93 : 94),
    gestora_nome: 'BLUEWAVE ASSET LTDA',
    gestora_cnpj: '13.703.306/0001-56',
    custodiante_nome: 'P0 Custodiante',
    custodiante_cnpj: cnpjFor(runId, label === 'A' ? 95 : 96),
    ativo: true,
  }).select('id').single()
  if (error) throw error
  createdFundos.push(data.id)
  return { id: data.id }
}

async function createCedenteAtivo(userId, fundo) {
  const { data: cedente, error } = await admin.from('cedentes').insert({
    user_id: userId,
    cnpj: cnpjFor(runId, 1),
    razao_social: `P0 CEDENTE GESTOR ${runId}`,
    status: 'ativo',
  }).select('id').single()
  if (error) throw error
  createdCedentes.push(cedente.id)

  const { error: vinculoError } = await admin.from('cedente_fundos').insert({
    cedente_id: cedente.id, fundo_id: fundo.id, status: 'ativo',
  })
  if (vinculoError) throw vinculoError
  return { id: cedente.id }
}

async function createActor(role, email) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { nome_completo: `P0 Gestor Doc ${role}`, role },
  })
  if (error || !data.user) throw error || new Error('Usuario sintetico nao criado.')
  createdUsers.push(data.user.id)
  const { error: profileError } = await admin.from('profiles').upsert({
    id: data.user.id, email, nome_completo: `P0 Gestor Doc ${role}`, role, status: 'ativo',
  })
  if (profileError) throw profileError
  return { id: data.user.id, email }
}

async function createGestor(label, fundo, vinculoStatus) {
  const actor = await createActor('gestor', `p0-doc-gestor-${label}-${runId}@example.invalid`)
  const { error } = await admin.from('usuario_fundos').insert({
    usuario_id: actor.id, fundo_id: fundo.id, status: vinculoStatus, perfil_no_fundo: 'gestor', principal: true,
  })
  if (error) throw error
  return actor
}

async function criarDocumento(cedenteId, tipo) {
  const { data, error } = await admin.from('documentos').insert({
    cedente_id: cedenteId, tipo, status: 'enviado', url_arquivo: `p0/${runId}/${tipo}.pdf`, nome_arquivo: `${tipo}.pdf`,
  }).select('id').single()
  if (error) throw error
  return { id: data.id }
}

async function authenticated(email) {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return client
}

async function expectAnalisarDenied(client, documentoId, decisao, motivo, label) {
  const { error } = await client.rpc('analisar_documento_gestor', { p_documento_id: documentoId, p_decisao: decisao, p_motivo: motivo ?? null })
  assert(Boolean(error), label)
}

async function expectSolicitarDenied(client, documentoId, label) {
  const { error } = await client.rpc('solicitar_atualizacao_documento_gestor', { p_documento_id: documentoId })
  assert(Boolean(error), label)
}

async function cleanup() {
  if (createdCedentes.length > 0) {
    await admin.from('documentos').delete().in('cedente_id', createdCedentes)
    await admin.from('cedente_fundos').delete().in('cedente_id', createdCedentes)
    await admin.from('cedentes').delete().in('id', createdCedentes)
  }
  if (createdFundos.length > 0) {
    await admin.from('usuario_fundos').delete().in('fundo_id', createdFundos)
    await admin.from('fundos').delete().in('id', createdFundos)
  }
  for (const id of createdUsers.reverse()) await admin.auth.admin.deleteUser(id).catch(() => undefined)
}

function cnpjFor(value, suffix) {
  const base = `${String(value).replace(/\D/g, '').slice(-10).padStart(10, '0')}${String(suffix).padStart(2, '0')}`
  const digits = base.split('').map(Number)
  const d1 = cnpjCheckDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = cnpjCheckDigit([...digits, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${base}${d1}${d2}`
}

function cnpjCheckDigit(digits, weights) {
  const soma = digits.reduce((acc, d, i) => acc + d * weights[i], 0)
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
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

function loadEnv(path) {
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}
