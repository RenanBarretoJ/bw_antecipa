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
const createdCedentes = []
const createdFundos = []
const createdStoragePaths = []
const checks = []

try {
  // ---- zero residuo do backfill: nenhum comprovante_endereco com representante_id ----
  const { count: residuo } = await admin
    .from('documentos')
    .select('id', { count: 'exact', head: true })
    .eq('tipo', 'comprovante_endereco')
    .not('representante_id', 'is', null)
  assert(residuo === 0, "zero linha remanescente com tipo='comprovante_endereco' e representante_id preenchido (backfill completo)")

  // ---- constraint estrutural bloqueia a combinacao invalida mesmo via service_role ----
  const cedenteProprio = await createActor('cedente', `p0-fcd-cedente-${runId}@example.invalid`)
  const cedente = await onboardCedente(cedenteProprio)
  const { data: rep } = await admin.from('representantes').select('id').eq('cedente_id', cedente.id).single()

  // ---- confirma a causa raiz do "6 de 6": o proprio Cedente tambem estava
  // sem SELECT em representantes (o GRANT revogado nao era exclusivo do Gestor).
  const clientCedenteParaRep = await authenticated(cedenteProprio.email)
  const { data: repsComoCedente, error: repsComoCedenteError } = await clientCedenteParaRep.from('representantes').select('id').eq('cedente_id', cedente.id)
  if (repsComoCedenteError) throw repsComoCedenteError
  assert((repsComoCedente || []).length === 1, 'o proprio Cedente agora consegue listar seus representantes (causa raiz do "6 de 6" incorreto)')

  const { error: erroComprovanteEnderecoComRep } = await admin.from('documentos').insert({
    cedente_id: cedente.id, tipo: 'comprovante_endereco', representante_id: rep.id, status: 'enviado',
  })
  assert(Boolean(erroComprovanteEnderecoComRep), "constraint bloqueia comprovante_endereco com representante_id preenchido")

  const { error: erroResidenciaSemRep } = await admin.from('documentos').insert({
    cedente_id: cedente.id, tipo: 'representante_comprovante_residencia', representante_id: null, status: 'enviado',
  })
  assert(Boolean(erroResidenciaSemRep), 'constraint bloqueia representante_comprovante_residencia sem representante_id')

  // ---- fluxo real: representante envia residencia, empresa envia endereco, ambos distintos ----
  const clientCedente = await authenticated(cedenteProprio.email)
  const enderecoPath = `${cedente.cnpj}/comprovante_endereco/${runId}_arquivo.pdf`
  const residenciaPath = `${cedente.cnpj}/representantes/${rep.id}/${runId}_arquivo.pdf`
  await uploadPdf(clientCedente, enderecoPath)
  await uploadPdf(clientCedente, residenciaPath)
  const { error: erroEmpresa } = await clientCedente.rpc('registrar_documento_cadastral_cedente', {
    p_tipo: 'comprovante_endereco', p_storage_path: enderecoPath, p_nome_arquivo: 'arquivo.pdf', p_representante_id: null,
  })
  const { error: erroRepresentante } = await clientCedente.rpc('registrar_documento_cadastral_cedente', {
    p_tipo: 'representante_comprovante_residencia', p_storage_path: residenciaPath, p_nome_arquivo: 'arquivo.pdf', p_representante_id: rep.id,
  })
  assert(!erroEmpresa, `RPC aceita comprovante_endereco da empresa (sem representante) = ALLOW${erroEmpresa ? ': ' + erroEmpresa.message : ''}`)
  assert(!erroRepresentante, `RPC aceita representante_comprovante_residencia do representante = ALLOW${erroRepresentante ? ': ' + erroRepresentante.message : ''}`)

  const { data: docsCedente } = await admin.from('documentos').select('tipo, representante_id').eq('cedente_id', cedente.id).in('tipo', ['comprovante_endereco', 'representante_comprovante_residencia'])
  const docEmpresa = docsCedente.find((d) => d.tipo === 'comprovante_endereco')
  const docRepresentante = docsCedente.find((d) => d.tipo === 'representante_comprovante_residencia')
  assert(Boolean(docEmpresa) && docEmpresa.representante_id === null, 'documento da empresa persistido com representante_id nulo')
  assert(Boolean(docRepresentante) && docRepresentante.representante_id === rep.id, 'documento do representante persistido com representante_id preenchido e tipo proprio')

  // ---- fila global do Gestor: escopo correto para os dois documentos ----
  const fundo = await createFundo(91)
  const fundoOutro = await createFundo(94)
  await admin.from('cedente_fundos').insert({ cedente_id: cedente.id, fundo_id: fundo.id, status: 'ativo' })
  const gestor = await createGestor(fundo, 'a')
  const gestorOutroFundo = await createGestor(fundoOutro, 'b')
  const clientGestor = await authenticated(gestor.email)
  const clientGestorOutroFundo = await authenticated(gestorOutroFundo.email)

  const { data: leakRepresentantes } = await clientGestorOutroFundo.from('representantes').select('id').eq('cedente_id', cedente.id)
  assert((leakRepresentantes || []).length === 0, 'gestor de outro fundo nao le os representantes deste cedente (zero leak)')

  const { data: filaGestor, error: filaError } = await clientGestor
    .from('documentos')
    .select('tipo, representante_id, representantes(nome)')
    .eq('cedente_id', cedente.id)
    .in('tipo', ['comprovante_endereco', 'representante_comprovante_residencia'])
  if (filaError) throw filaError
  const linhaEmpresa = filaGestor.find((d) => d.tipo === 'comprovante_endereco')
  const linhaRepresentante = filaGestor.find((d) => d.tipo === 'representante_comprovante_residencia')
  assert(Boolean(linhaEmpresa) && linhaEmpresa.representante_id === null, 'gestor le o documento da empresa com escopo empresa (sem representante)')
  assert(Boolean(linhaRepresentante) && !!linhaRepresentante.representantes?.nome, 'gestor le o documento do representante com o nome do representante disponivel para o escopo')

  console.log(JSON.stringify({ status: 'PASS', environment: 'homolog', project_ref: projectRef, production_touched: false, checks }, null, 2))
} finally {
  await cleanup()
}

async function onboardCedente(cedenteProprio) {
  const client = await authenticated(cedenteProprio.email)
  const { data, error } = await client.rpc('concluir_onboarding_cedente', {
    p_cadastro: {
      cnpj: cnpjFor(runId, 1),
      razao_social: `P0 FILIAIS CONSISTENCIA ${runId}`,
      representantes: [{ nome: 'Representante Teste', cpf: cpfFor(runId), rg: '123456789', cargo: 'Socio', email: `rep-${runId}@example.invalid`, telefone: '11999999999' }],
    },
  })
  if (error) throw error
  createdCedentes.push(data.id)
  return { id: data.id, cnpj: cnpjFor(runId, 1) }
}

async function createFundo(suffix = 91) {
  const { data, error } = await admin.from('fundos').insert({
    nome: `P0 Fundo FCD ${suffix} ${runId}`, cnpj: cnpjFor(runId, suffix), administradora_nome: 'Adm Teste', administradora_cnpj: cnpjFor(runId, suffix + 1),
    gestora_nome: 'BLUEWAVE ASSET LTDA', gestora_cnpj: '13.703.306/0001-56', custodiante_nome: 'Custodiante Teste', custodiante_cnpj: cnpjFor(runId, suffix + 2), ativo: true,
  }).select('id').single()
  if (error) throw error
  createdFundos.push(data.id)
  return { id: data.id }
}

async function createActor(role, email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role } })
  if (error || !data.user) throw error || new Error('Usuario sintetico nao criado.')
  createdUsers.push(data.user.id)
  const { error: profileError } = await admin.from('profiles').upsert({ id: data.user.id, email, nome_completo: `P0 FCD ${role}`, role, status: 'ativo' })
  if (profileError) throw profileError
  return { id: data.user.id, email }
}

async function createGestor(fundo, label = 'a') {
  const actor = await createActor('gestor', `p0-fcd-gestor-${label}-${runId}@example.invalid`)
  const { error } = await admin.from('usuario_fundos').insert({ usuario_id: actor.id, fundo_id: fundo.id, status: 'ativo', perfil_no_fundo: 'gestor', principal: true })
  if (error) throw error
  return actor
}

async function uploadPdf(client, path) {
  const { error } = await client.storage.from('documentos-cedentes').upload(path, new Blob(['%PDF-1.4\n% P0 teste\n'], { type: 'application/pdf' }), { contentType: 'application/pdf' })
  if (error) throw error
  createdStoragePaths.push(path)
}

async function authenticated(email) {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return client
}

async function cleanup() {
  if (createdStoragePaths.length > 0) {
    await admin.storage.from('documentos-cedentes').remove(createdStoragePaths)
  }
  if (createdCedentes.length > 0) {
    await admin.from('documentos').delete().in('cedente_id', createdCedentes)
    await admin.from('representantes').delete().in('cedente_id', createdCedentes)
    await admin.from('cedente_estabelecimentos').delete().in('cedente_id', createdCedentes)
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
function cpfFor(seed) {
  const base = String(seed).replace(/\D/g, '').slice(-9).padStart(9, '1')
  const digits = base.split('').map(Number)
  const d1 = cpfCheckDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = cpfCheckDigit([...digits, d1], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${base}${d1}${d2}`
}
function cpfCheckDigit(digits, weights) {
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}
