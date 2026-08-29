#!/usr/bin/env node

import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

loadEnv(resolve('.env.homolog'))

const url = required('NEXT_PUBLIC_SUPABASE_URL')
const anonKey = required('NEXT_PUBLIC_SUPABASE_ANON_KEY')
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY')
const projectRef = new URL(url).hostname.split('.')[0]
const productionRef = required('SUPABASE_PRODUCTION_PROJECT_REF')

if (projectRef !== 'fhgkmggthxikfpogrvaa') throw new Error(`Projeto de homologacao inesperado: ${projectRef}`)
if (projectRef === productionRef) throw new Error('Execucao bloqueada: homologacao coincide com producao.')

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
const createdUserIds = []
const checks = []

try {
  const cedenteA = await createQaActor('cedente')
  const cedenteB = await createQaActor('cedente')
  const gestor = await createQaActor('gestor')
  const consultor = await createQaActor('consultor')

  const payloadA = cadastroPayload(cnpjValido(crypto.randomInt(10_000_000)))
  const first = await cedenteA.client.rpc('concluir_onboarding_cedente', { p_cadastro: payloadA })
  assertNoError(first.error, 'cedente autenticado conclui o proprio cadastro')
  assert(first.data?.criado === true && first.data?.idempotente === false, 'primeira chamada nao criou o cadastro')
  ok('cedente autenticado conclui o proprio cadastro')

  const replay = await cedenteA.client.rpc('concluir_onboarding_cedente', { p_cadastro: payloadA })
  assertNoError(replay.error, 'repeticao idempotente')
  assert(replay.data?.id === first.data?.id && replay.data?.idempotente === true, 'repeticao criou resultado divergente')
  const { count: ownCount, error: ownCountError } = await admin
    .from('cedentes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', cedenteA.id)
  assertNoError(ownCountError, 'contagem idempotente')
  assert(ownCount === 1, `repeticao produziu ${ownCount ?? 0} cadastros`)
  ok('repeticao nao duplica cedente')

  const { count: representatives, error: representativesError } = await admin
    .from('representantes')
    .select('id', { count: 'exact', head: true })
    .eq('cedente_id', first.data.id)
  assertNoError(representativesError, 'representantes atomicos')
  assert(representatives === payloadA.representantes.length, 'representantes nao foram persistidos atomicamente')
  ok('representantes persistidos na mesma conclusao')

  const crossUser = await cedenteB.client.rpc('concluir_onboarding_cedente', {
    p_cadastro: { ...cadastroPayload(cnpjValido(crypto.randomInt(10_000_000))), user_id: cedenteA.id },
  })
  assertDenied(crossUser.error, '22023', 'tentativa de escolher outro usuario')
  ok('tentativa de cadastro para terceiro bloqueada')

  const crossFund = await cedenteB.client.rpc('concluir_onboarding_cedente', {
    p_cadastro: { ...cadastroPayload(cnpjValido(crypto.randomInt(10_000_000))), fundo_id: crypto.randomUUID() },
  })
  assertDenied(crossFund.error, '22023', 'tentativa de escolher fundo')
  ok('fundo enviado pelo cliente bloqueado')

  const anonymous = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const anonResult = await anonymous.rpc('concluir_onboarding_cedente', {
    p_cadastro: cadastroPayload(cnpjValido(crypto.randomInt(10_000_000))),
  })
  assert(anonResult.error, 'anonimo conseguiu executar a RPC')
  ok('anonimo bloqueado')

  for (const actor of [gestor, consultor]) {
    const result = await actor.client.rpc('concluir_onboarding_cedente', {
      p_cadastro: cadastroPayload(cnpjValido(crypto.randomInt(10_000_000))),
    })
    assertDenied(result.error, '42501', `${actor.role} concluiu onboarding de cedente`)
    ok(`${actor.role} bloqueado para escrita cadastral`)
  }

  const directInsert = await cedenteB.client.from('cedentes').insert({
    user_id: cedenteB.id,
    cnpj: cnpjValido(crypto.randomInt(10_000_000)),
    razao_social: 'P0 TENTATIVA DIRETA',
    status: 'pendente',
  })
  assert(directInsert.error, 'INSERT direto permaneceu permitido')
  ok('INSERT direto continua revogado')

  const { count: cedenteBCount, error: cedenteBCountError } = await admin
    .from('cedentes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', cedenteB.id)
  assertNoError(cedenteBCountError, 'verificacao de efeitos negados')
  assert(cedenteBCount === 0, 'tentativas negadas deixaram cadastro parcial')
  ok('negacoes nao deixam dados parciais')

  console.log(`\nP0 onboarding homolog: ${checks.length} verificacoes aprovadas no projeto ${projectRef}.`)
  for (const check of checks) console.log(`- [OK] ${check}`)
} finally {
  for (const userId of createdUserIds.reverse()) {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined)
  }
}

async function createQaActor(role) {
  const password = `P0!${crypto.randomBytes(18).toString('base64url')}aA1`
  const email = `qa.p0.onboarding.${role}.${Date.now()}.${crypto.randomUUID().slice(0, 8)}@example.invalid`
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nome_completo: `QA P0 ${role}`, role },
  })
  assertNoError(error, `criacao do ator ${role}`)
  createdUserIds.push(data.user.id)

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const login = await client.auth.signInWithPassword({ email, password })
  assertNoError(login.error, `login do ator ${role}`)
  assert(login.data.user?.id === data.user.id, `sessao incorreta para ${role}`)
  ok(`login ${role} preservado`)
  return { id: data.user.id, role, client }
}

function cadastroPayload(cnpj) {
  return {
    cnpj,
    razao_social: `QA P0 CEDENTE ${cnpj}`,
    nome_fantasia: 'QA P0',
    cep: '01310100',
    logradouro: 'Avenida Paulista',
    numero: '1000',
    complemento: '',
    bairro: 'Bela Vista',
    cidade: 'Sao Paulo',
    estado: 'SP',
    telefone_comercial: '11999999999',
    email_comercial: `qa-${cnpj}@example.invalid`,
    cnae: '6201501',
    banco: '001',
    agencia: '1234',
    conta: '123456',
    tipo_conta: 'corrente',
    representantes: [{
      nome: 'Representante QA P0',
      cpf: '52998224725',
      rg: '123456789',
      cargo: 'Diretor',
      email: `representante-${cnpj}@example.invalid`,
      telefone: '11988888888',
    }],
  }
}

function cnpjValido(seed) {
  const base = String(seed).padStart(8, '0').slice(-8) + '0001'
  const digit = (value, weights) => {
    const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0)
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }
  const d1 = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digit(`${base}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${base}${d1}${d2}`
}

function assertDenied(error, code, context) {
  assert(error, `${context}: operacao foi aceita`)
  assert(error.code === code, `${context}: esperado ${code}, recebido ${error.code || 'sem codigo'}`)
}

function assertNoError(error, context) {
  if (error) throw new Error(`${context}: ${error.message} (${error.code || 'sem codigo'})`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function ok(message) {
  checks.push(message)
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}
