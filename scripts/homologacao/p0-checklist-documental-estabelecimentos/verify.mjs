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
const createdEstabelecimentos = []
const checks = []

try {
  // ---- catalogo: dominio 'cadastro' mostra so os tipos certos ----
  const { data: catalogoCadastro, error: catalogoError } = await admin
    .from('documento_tipos')
    .select('codigo, dominio')
    .eq('ativo', true)
    .eq('dominio', 'cadastro')
  if (catalogoError) throw catalogoError
  const codigosCadastro = (catalogoCadastro || []).map((t) => t.codigo)
  assert(
    ['estabelecimento_cartao_cnpj', 'estabelecimento_comprovante_endereco', 'estabelecimento_contrato_social', 'estabelecimento_comprovante_faturamento'].every((c) => codigosCadastro.includes(c)),
    "dominio 'cadastro' contem os 4 tipos cadastrais esperados",
  )
  assert(
    !codigosCadastro.some((c) => ['nf_xml', 'nf_danfe_pdf', 'nf_pedido_compra'].includes(c)),
    "tipos de LASTRO_NF (nf_xml, nf_danfe_pdf, nf_pedido_compra) nao aparecem no dominio 'cadastro'",
  )

  // ---- fixtures ----
  // cedentes/cedente_estabelecimentos so aceitam escrita pelas RPCs SECURITY
  // DEFINER: triggers de validacao de CNPJ (private.cnpj_valido) sao
  // revogadas ate mesmo de service_role, exatamente para impedir bypass por
  // INSERT direto. O fluxo abaixo reproduz o caminho real da aplicacao.
  const fundoA = await createFundo('A')
  const fundoB = await createFundo('B')
  const cedenteProprio = await createActor('cedente', `p0-chk-doc-cedente-${runId}@example.invalid`)
  const clientCedente = await authenticated(cedenteProprio.email)

  const cedenteC1 = await onboardCedente(clientCedente)
  const { error: vinculoError } = await admin.from('cedente_fundos').insert({ cedente_id: cedenteC1.id, fundo_id: fundoA.id, status: 'ativo' })
  if (vinculoError) throw vinculoError

  const gestorAtivoFundoA = await createGestor('ga', fundoA, 'ativo')
  const gestorFundoB = await createGestor('gb', fundoB, 'ativo')
  const gestorVinculoRevogado = await createGestor('gc', fundoA, 'revogado')
  const superAdminPuro = await createActor('super_admin', `p0-chk-doc-sa-${runId}@example.invalid`)

  const clientGA = await authenticated(gestorAtivoFundoA.email)
  const clientGB = await authenticated(gestorFundoB.email)
  const clientGC = await authenticated(gestorVinculoRevogado.email)
  const clientSA = await authenticated(superAdminPuro.email)
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { error: aprovarCedenteError } = await clientGA.rpc('aprovar_cadastro_cedente_gestor', { p_cedente_id: cedenteC1.id })
  if (aprovarCedenteError) throw aprovarCedenteError

  const matriz = await buscarMatriz(cedenteC1.id)
  const { error: aprovarMatrizError } = await clientGA.rpc('decidir_estabelecimento_gestor', { p_estabelecimento_id: matriz.id, p_acao: 'aprovar', p_motivo: null })
  if (aprovarMatrizError) throw aprovarMatrizError

  const { data: filialData, error: filialError } = await clientCedente.rpc('cadastrar_filial_cedente', {
    p_cnpj: cnpjFor(runId, 2), p_razao_social: `P0 FILIAL CHECKLIST ${runId}`, p_nome_fantasia: null,
  })
  if (filialError) throw filialError
  const filial = { id: filialData.id }
  createdEstabelecimentos.push(filial.id)

  const { data: tipoCartaoCnpj } = await admin.from('documento_tipos').select('id').eq('codigo', 'estabelecimento_cartao_cnpj').single()
  const { data: tipoComprovanteEndereco } = await admin.from('documento_tipos').select('id').eq('codigo', 'estabelecimento_comprovante_endereco').single()

  // ---- DENY matrix (Matriz) ----
  await expectRpcDenied(clientGB, matriz.id, tipoCartaoCnpj.id, 'gestor de outro fundo configura requisito na Matriz = DENY')
  await expectRpcDenied(clientGC, matriz.id, tipoCartaoCnpj.id, 'gestor com vinculo revogado configura requisito na Matriz = DENY')
  await expectRpcDenied(clientSA, matriz.id, tipoCartaoCnpj.id, 'super admin puro configura requisito na Matriz = DENY')
  await expectRpcDenied(clientCedente, matriz.id, tipoCartaoCnpj.id, 'cedente configura o proprio requisito = DENY')
  await expectRpcDenied(anon, matriz.id, tipoCartaoCnpj.id, 'anon configura requisito na Matriz = DENY')

  // ---- ALLOW: gestor do fundo correto na Matriz ----
  const { data: requisitoMatriz, error: matrizError } = await clientGA.rpc('configurar_requisito_estabelecimento_gestor', {
    p_estabelecimento_id: matriz.id, p_documento_tipo_id: tipoCartaoCnpj.id, p_obrigatorio: true, p_ativo: true, p_observacoes: null,
  })
  if (matrizError) throw matrizError
  assert(requisitoMatriz?.requisito?.ativo === true && requisitoMatriz?.requisito?.obrigatorio === true, 'gestor do fundo correto configura requisito na Matriz = ALLOW')

  // ---- ALLOW: gestor do fundo correto na Filial ----
  await expectRpcDenied(clientGB, filial.id, tipoComprovanteEndereco.id, 'gestor de outro fundo configura requisito na Filial = DENY')
  const { data: requisitoFilial, error: requisitoFilialError } = await clientGA.rpc('configurar_requisito_estabelecimento_gestor', {
    p_estabelecimento_id: filial.id, p_documento_tipo_id: tipoComprovanteEndereco.id, p_obrigatorio: false, p_ativo: true, p_observacoes: 'Endereco especifico da filial.',
  })
  if (requisitoFilialError) throw requisitoFilialError
  assert(requisitoFilial?.requisito?.obrigatorio === false && requisitoFilial?.requisito?.ativo === true, 'gestor do fundo correto configura requisito na Filial = ALLOW')

  // ---- persistencia apos reload (nova leitura, simulando reload de pagina) ----
  const { data: releitura, error: releituraError } = await clientGA
    .from('cedente_estabelecimento_requisitos')
    .select('*')
    .eq('estabelecimento_id', matriz.id)
    .eq('documento_tipo_id', tipoCartaoCnpj.id)
    .single()
  if (releituraError) throw releituraError
  assert(releitura?.ativo === true, 'requisito da Matriz persiste apos releitura (reload)')

  // ---- desativacao ----
  const { data: desativado, error: desativarError } = await clientGA.rpc('configurar_requisito_estabelecimento_gestor', {
    p_estabelecimento_id: matriz.id, p_documento_tipo_id: tipoCartaoCnpj.id, p_obrigatorio: true, p_ativo: false, p_observacoes: null,
  })
  if (desativarError) throw desativarError
  assert(desativado?.requisito?.ativo === false, 'desativacao do requisito da Matriz = ALLOW e persiste')

  // ---- zero cross-fund leak ----
  const { data: leakRows } = await clientGB.from('cedente_estabelecimento_requisitos').select('id').in('estabelecimento_id', [matriz.id, filial.id])
  assert((leakRows || []).length === 0, 'gestor de outro fundo nao le os requisitos destes estabelecimentos (zero leak)')

  console.log(JSON.stringify({ status: 'PASS', environment: 'homolog', project_ref: projectRef, production_touched: false, checks }, null, 2))
} finally {
  await cleanup()
}

async function createFundo(label) {
  const { data, error } = await admin.from('fundos').insert({
    nome: `P0 Fundo Checklist ${label} ${runId}`,
    cnpj: cnpjFor(runId, label === 'A' ? 81 : 82),
    administradora_nome: 'P0 Administradora',
    administradora_cnpj: cnpjFor(runId, label === 'A' ? 83 : 84),
    gestora_nome: 'BLUEWAVE ASSET LTDA',
    gestora_cnpj: '13.703.306/0001-56',
    custodiante_nome: 'P0 Custodiante',
    custodiante_cnpj: cnpjFor(runId, label === 'A' ? 85 : 86),
    ativo: true,
  }).select('id').single()
  if (error) throw error
  createdFundos.push(data.id)
  return { id: data.id }
}

async function onboardCedente(clientCedente) {
  const { data, error } = await clientCedente.rpc('concluir_onboarding_cedente', {
    p_cadastro: {
      cnpj: cnpjFor(runId, 1),
      razao_social: `P0 CEDENTE CHECKLIST ${runId}`,
      representantes: [{
        nome: 'Representante Teste P0', cpf: cpfFor(runId), rg: '123456789', cargo: 'Socio',
        email: `p0-chk-doc-rep-${runId}@example.invalid`, telefone: '11999999999',
      }],
    },
  })
  if (error) throw error
  createdCedentes.push(data.id)
  return { id: data.id }
}

async function buscarMatriz(cedenteId) {
  const { data, error } = await admin.from('cedente_estabelecimentos').select('id').eq('cedente_id', cedenteId).eq('tipo', 'matriz').single()
  if (error) throw new Error(`Matriz nao foi auto-criada pelo trigger: ${error.message}`)
  createdEstabelecimentos.push(data.id)
  return { id: data.id }
}

async function createActor(role, email) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { nome_completo: `P0 Checklist ${role}`, role },
  })
  if (error || !data.user) throw error || new Error('Usuario sintetico nao criado.')
  createdUsers.push(data.user.id)
  const { error: profileError } = await admin.from('profiles').upsert({
    id: data.user.id, email, nome_completo: `P0 Checklist ${role}`, role, status: 'ativo',
  })
  if (profileError) throw profileError
  return { id: data.user.id, email }
}

async function createGestor(label, fundo, vinculoStatus) {
  const actor = await createActor('gestor', `p0-chk-doc-gestor-${label}-${runId}@example.invalid`)
  const { error } = await admin.from('usuario_fundos').insert({
    usuario_id: actor.id, fundo_id: fundo.id, status: vinculoStatus, perfil_no_fundo: 'gestor', principal: true,
  })
  if (error) throw error
  return actor
}

async function authenticated(email) {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return client
}

async function expectRpcDenied(client, estabelecimentoId, documentoTipoId, label) {
  const { error } = await client.rpc('configurar_requisito_estabelecimento_gestor', {
    p_estabelecimento_id: estabelecimentoId, p_documento_tipo_id: documentoTipoId, p_obrigatorio: true, p_ativo: true, p_observacoes: null,
  })
  assert(Boolean(error), label)
}

async function cleanup() {
  if (createdEstabelecimentos.length > 0) {
    await admin.from('cedente_estabelecimento_requisitos').delete().in('estabelecimento_id', createdEstabelecimentos)
  }
  if (createdCedentes.length > 0) {
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}
