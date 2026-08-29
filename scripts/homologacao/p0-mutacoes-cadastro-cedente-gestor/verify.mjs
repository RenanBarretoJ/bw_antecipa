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

  const cedenteProprioC1 = await createActor('cedente', `p0-mut-ced-c1-${runId}@example.invalid`)
  const cedenteC1 = await createCedente(cedenteProprioC1.id, fundoA, 1)
  const cedenteProprioC2 = await createActor('cedente', `p0-mut-ced-c2-${runId}@example.invalid`)
  const cedenteC2 = await createCedente(cedenteProprioC2.id, fundoA, 2)

  const gestorAtivoFundoA = await createGestor('ga', fundoA, 'ativo')
  const gestorFundoB = await createGestor('gb', fundoB, 'ativo')
  const gestorVinculoRevogado = await createGestor('gc', fundoA, 'revogado')
  const superAdminPuro = await createActor('super_admin', `p0-mut-sa-${runId}@example.invalid`)
  const consultor = await createActor('consultor', `p0-mut-co-${runId}@example.invalid`)

  const clientGA = await authenticated(gestorAtivoFundoA.email)
  const clientGB = await authenticated(gestorFundoB.email)
  const clientGC = await authenticated(gestorVinculoRevogado.email)
  const clientSA = await authenticated(superAdminPuro.email)
  const clientCO = await authenticated(consultor.email)
  const clientCedente = await authenticated(cedenteProprioC1.email)
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // ---- 1) Aprovar Cadastro ----
  await expectRpcDenied(clientGB, 'aprovar_cadastro_cedente_gestor', { p_cedente_id: cedenteC1.id }, 'gestor de outro fundo aprova cadastro = DENY')
  await expectRpcDenied(clientGC, 'aprovar_cadastro_cedente_gestor', { p_cedente_id: cedenteC1.id }, 'gestor com vinculo revogado aprova cadastro = DENY')
  await expectRpcDenied(clientSA, 'aprovar_cadastro_cedente_gestor', { p_cedente_id: cedenteC1.id }, 'super admin puro aprova cadastro = DENY')
  await expectRpcDenied(clientCedente, 'aprovar_cadastro_cedente_gestor', { p_cedente_id: cedenteC1.id }, 'cedente aprova o proprio cadastro = DENY')
  await expectRpcDenied(clientCO, 'aprovar_cadastro_cedente_gestor', { p_cedente_id: cedenteC1.id }, 'consultor aprova cadastro = DENY')
  await expectRpcDenied(anon, 'aprovar_cadastro_cedente_gestor', { p_cedente_id: cedenteC1.id }, 'anon aprova cadastro = DENY')

  const { error: directUpdateError } = await clientGA.from('cedentes').update({ status: 'ativo' }).eq('id', cedenteC1.id)
  assert(Boolean(directUpdateError) && /permission denied/i.test(directUpdateError.message), 'UPDATE direto em cedentes continua DENY (permission denied)')

  const { data: aprovado, error: aprovarError } = await clientGA.rpc('aprovar_cadastro_cedente_gestor', { p_cedente_id: cedenteC1.id })
  if (aprovarError) throw aprovarError
  const aprovadoRow = Array.isArray(aprovado) ? aprovado[0] : aprovado
  assert(aprovadoRow?.status === 'ativo' && !!aprovadoRow?.conta_escrow_identificador, 'gestor do fundo correto aprova cadastro = ALLOW (status ativo + conta escrow criada)')

  const { count: contaCount } = await admin.from('contas_escrow').select('id', { count: 'exact', head: true }).eq('cedente_id', cedenteC1.id)
  assert(contaCount === 1, 'conta escrow criada exatamente uma vez')

  await expectRpcDenied(clientGA, 'aprovar_cadastro_cedente_gestor', { p_cedente_id: cedenteC1.id }, 'reaprovar cedente ja ativo = DENY (transicao invalida)')

  // ---- 2) Reprovar Cadastro (cedente separado, ainda pendente) ----
  await expectRpcDenied(clientGB, 'reprovar_cadastro_cedente_gestor', { p_cedente_id: cedenteC2.id }, 'gestor de outro fundo reprova cadastro = DENY')
  await expectRpcDenied(anon, 'reprovar_cadastro_cedente_gestor', { p_cedente_id: cedenteC2.id }, 'anon reprova cadastro = DENY')

  const { data: reprovado, error: reprovarError } = await clientGA.rpc('reprovar_cadastro_cedente_gestor', { p_cedente_id: cedenteC2.id })
  if (reprovarError) throw reprovarError
  const reprovadoRow = Array.isArray(reprovado) ? reprovado[0] : reprovado
  assert(reprovadoRow?.status === 'reprovado', 'gestor do fundo correto reprova cadastro = ALLOW')

  // ---- 3) Escrow ----
  await expectRpcDenied(clientGB, 'alternar_escrow_cedente_gestor', { p_cedente_id: cedenteC1.id, p_habilitar: true }, 'gestor de outro fundo altera escrow = DENY')
  await expectRpcDenied(anon, 'alternar_escrow_cedente_gestor', { p_cedente_id: cedenteC1.id, p_habilitar: true }, 'anon altera escrow = DENY')
  const { data: escrowOn, error: escrowError } = await clientGA.rpc('alternar_escrow_cedente_gestor', { p_cedente_id: cedenteC1.id, p_habilitar: true })
  if (escrowError) throw escrowError
  assert((Array.isArray(escrowOn) ? escrowOn[0] : escrowOn)?.habilitar_escrow === true, 'gestor do fundo correto habilita escrow = ALLOW')

  // ---- 4) Coobrigacao ----
  await expectRpcDenied(clientGB, 'alternar_coobrigacao_cedente_gestor', { p_cedente_id: cedenteC1.id, p_habilitar: true }, 'gestor de outro fundo altera coobrigacao = DENY')
  const { data: coobrigOn, error: coobrigError } = await clientGA.rpc('alternar_coobrigacao_cedente_gestor', { p_cedente_id: cedenteC1.id, p_habilitar: true })
  if (coobrigError) throw coobrigError
  assert((Array.isArray(coobrigOn) ? coobrigOn[0] : coobrigOn)?.coobrigacao === true, 'gestor do fundo correto habilita coobrigacao = ALLOW')

  // ---- 5) Aprovar alteracao cadastral ----
  const solicitacaoAprovar = await criarSolicitacaoAlteracao(cedenteC1.id, { razao_social: `P0 RAZAO ATUALIZADA ${runId}` })
  await expectRpcDenied(clientGB, 'aprovar_alteracao_cadastral_cedente_gestor', { p_solicitacao_id: solicitacaoAprovar.id }, 'gestor de outro fundo aprova alteracao cadastral = DENY')
  await expectRpcDenied(clientSA, 'aprovar_alteracao_cadastral_cedente_gestor', { p_solicitacao_id: solicitacaoAprovar.id }, 'super admin puro aprova alteracao cadastral = DENY')
  const { data: alteracaoAprovada, error: aprovarAlteracaoError } = await clientGA.rpc('aprovar_alteracao_cadastral_cedente_gestor', { p_solicitacao_id: solicitacaoAprovar.id })
  if (aprovarAlteracaoError) throw aprovarAlteracaoError
  assert((Array.isArray(alteracaoAprovada) ? alteracaoAprovada[0] : alteracaoAprovada)?.status === 'aprovada', 'gestor do fundo correto aprova alteracao cadastral = ALLOW')
  const { data: cedenteAtualizado } = await admin.from('cedentes').select('razao_social').eq('id', cedenteC1.id).single()
  assert(cedenteAtualizado?.razao_social === `P0 RAZAO ATUALIZADA ${runId}`, 'campo proposto foi aplicado ao cedente')
  await expectRpcDenied(clientGA, 'aprovar_alteracao_cadastral_cedente_gestor', { p_solicitacao_id: solicitacaoAprovar.id }, 'reaprovar solicitacao ja decidida = DENY')

  // ---- 6) Reprovar alteracao cadastral ----
  const solicitacaoReprovar = await criarSolicitacaoAlteracao(cedenteC1.id, { razao_social: 'Nao deve ser aplicado' })
  const { error: semMotivoError } = await clientGA.rpc('reprovar_alteracao_cadastral_cedente_gestor', { p_solicitacao_id: solicitacaoReprovar.id, p_motivo: '' })
  assert(Boolean(semMotivoError), 'reprovar alteracao cadastral sem motivo = DENY (validacao)')
  await expectRpcDenied(clientGB, 'reprovar_alteracao_cadastral_cedente_gestor', { p_solicitacao_id: solicitacaoReprovar.id, p_motivo: 'motivo qualquer' }, 'gestor de outro fundo reprova alteracao cadastral = DENY')
  const { data: alteracaoReprovada, error: reprovarAlteracaoError } = await clientGA.rpc('reprovar_alteracao_cadastral_cedente_gestor', { p_solicitacao_id: solicitacaoReprovar.id, p_motivo: 'Dados desatualizados.' })
  if (reprovarAlteracaoError) throw reprovarAlteracaoError
  assert((Array.isArray(alteracaoReprovada) ? alteracaoReprovada[0] : alteracaoReprovada)?.status === 'reprovada', 'gestor do fundo correto reprova alteracao cadastral com motivo = ALLOW')
  const { data: cedenteNaoAlterado } = await admin.from('cedentes').select('razao_social').eq('id', cedenteC1.id).single()
  assert(cedenteNaoAlterado?.razao_social !== 'Nao deve ser aplicado', 'alteracao reprovada nao aplica os campos propostos')

  // ---- Taxas: protegida por RLS multifundo (nao e RPC; testada diretamente) ----
  const { error: taxaGaError } = await clientGA.from('taxas_cedente').insert({ cedente_id: cedenteC1.id, prazo_min: 0, prazo_max: 30, taxa_percentual: 2.5 })
  assert(!taxaGaError, 'gestor do fundo correto grava taxa pre-configurada = ALLOW (RLS)')
  const { error: taxaGbError } = await clientGB.from('taxas_cedente').insert({ cedente_id: cedenteC1.id, prazo_min: 0, prazo_max: 30, taxa_percentual: 9.9 })
  assert(Boolean(taxaGbError), 'gestor de outro fundo nao grava taxa deste cedente = DENY (RLS)')

  // ---- zero cross-fund leak na leitura ----
  const { data: leakRows } = await clientGB.from('cedentes').select('id').in('id', [cedenteC1.id, cedenteC2.id])
  assert((leakRows || []).length === 0, 'gestor de outro fundo nao le estes cedentes (zero leak)')

  console.log(JSON.stringify({ status: 'PASS', environment: 'homolog', project_ref: projectRef, production_touched: false, checks }, null, 2))
} finally {
  await cleanup()
}

async function createFundo(label) {
  const { data, error } = await admin.from('fundos').insert({
    nome: `P0 Fundo Mutacoes ${label} ${runId}`,
    cnpj: cnpjFor(runId, label === 'A' ? 71 : 72),
    administradora_nome: 'P0 Administradora',
    administradora_cnpj: cnpjFor(runId, label === 'A' ? 73 : 74),
    gestora_nome: 'BLUEWAVE ASSET LTDA',
    gestora_cnpj: '13.703.306/0001-56',
    custodiante_nome: 'P0 Custodiante',
    custodiante_cnpj: cnpjFor(runId, label === 'A' ? 75 : 76),
    ativo: true,
  }).select('id').single()
  if (error) throw error
  createdFundos.push(data.id)
  return { id: data.id }
}

async function createCedente(userId, fundo, suffix) {
  const { data: cedente, error } = await admin.from('cedentes').insert({
    user_id: userId,
    cnpj: cnpjFor(runId, suffix),
    razao_social: `P0 CEDENTE MUTACOES ${suffix} ${runId}`,
    status: 'pendente',
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
    email, password, email_confirm: true, user_metadata: { nome_completo: `P0 Mutacoes ${role}`, role },
  })
  if (error || !data.user) throw error || new Error('Usuario sintetico nao criado.')
  createdUsers.push(data.user.id)
  const { error: profileError } = await admin.from('profiles').upsert({
    id: data.user.id, email, nome_completo: `P0 Mutacoes ${role}`, role, status: 'ativo',
  })
  if (profileError) throw profileError
  return { id: data.user.id, email }
}

async function createGestor(label, fundo, vinculoStatus) {
  const actor = await createActor('gestor', `p0-mut-gestor-${label}-${runId}@example.invalid`)
  const { error } = await admin.from('usuario_fundos').insert({
    usuario_id: actor.id, fundo_id: fundo.id, status: vinculoStatus, perfil_no_fundo: 'gestor', principal: true,
  })
  if (error) throw error
  return actor
}

async function criarSolicitacaoAlteracao(cedenteId, dadosPropostos) {
  const { data, error } = await admin.from('solicitacoes_alteracao_cedente').insert({
    cedente_id: cedenteId,
    dados_atuais: {},
    dados_propostos: dadosPropostos,
    representantes_atuais: [],
    representantes_propostos: [],
    status: 'pendente',
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

async function expectRpcDenied(client, fn, args, label) {
  const { error } = await client.rpc(fn, args)
  assert(Boolean(error), label)
}

async function cleanup() {
  if (createdCedentes.length > 0) {
    await admin.from('solicitacoes_alteracao_cedente').delete().in('cedente_id', createdCedentes)
    await admin.from('taxas_cedente').delete().in('cedente_id', createdCedentes)
    await admin.from('contas_escrow').delete().in('cedente_id', createdCedentes)
    await admin.from('representantes').delete().in('cedente_id', createdCedentes)
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
