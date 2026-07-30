#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  PERF9A_PREFIX,
  assertHomologEnvironment,
  createAdminClient,
  getPerf9aLocalDir,
  loadEnvFile,
  parseArgs,
  printEnvironmentSummary,
  writeRestrictedJson,
} from './common.mjs'
import { generateTotp } from './dataset.mjs'

const args = parseArgs()

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main()
  } catch (error) {
    console.error(`\nVerificacao PERF9A falhou: ${safeError(error)}\n`)
    process.exitCode = 1
  }
}

async function main() {
  loadEnvFile(args['env-file'])
  const env = assertHomologEnvironment()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY ausente.')

  console.log('\nBW Antecipa - verificacao autenticada PERF9A')
  printEnvironmentSummary(env)

  const credentialsPath = resolve(
    getPerf9aLocalDir('credentials'),
    `users-${env.projectRef}.json`,
  )
  const credentialFile = JSON.parse(readFileSync(credentialsPath, 'utf8'))
  if (credentialFile.projectRef !== env.projectRef) {
    throw new Error('Arquivo de credenciais pertence a outro projeto Supabase.')
  }

  const users = new Map(credentialFile.users.map((user) => [user.key, user]))
  const admin = createAdminClient(env)
  const fixtures = await loadFixtures(admin)
  const cases = []

  const gestorA = await createAal2Client(env, anonKey, requireCredential(users, 'gestor_a'))
  const gestorB = await createAal2Client(env, anonKey, requireCredential(users, 'gestor_b'))
  const consultorA = await createAal2Client(env, anonKey, requireCredential(users, 'consultor_a'))
  const cedenteA = await createAal2Client(env, anonKey, requireCredential(users, 'cedente_a'))
  const sacadoA = await createAal2Client(env, anonKey, requireCredential(users, 'sacado_a'))

  await recordVisibility(cases, gestorA, {
    actor: 'gestor_a',
    scenario: 'fundo autorizado A',
    table: 'fundos',
    id: fixtures.fundA.id,
    expectedVisible: true,
  })
  await recordVisibility(cases, gestorA, {
    actor: 'gestor_a',
    scenario: 'fundo B nao autorizado',
    table: 'fundos',
    id: fixtures.fundB.id,
    expectedVisible: false,
    blocker: 'acesso cruzado entre fundos',
  })
  await recordVisibility(cases, gestorA, {
    actor: 'gestor_a',
    scenario: 'operacao do fundo B por ID',
    table: 'operacoes',
    id: fixtures.operationB.id,
    expectedVisible: false,
    blocker: 'acesso cruzado entre fundos',
  })
  await recordVisibility(cases, gestorA, {
    actor: 'gestor_a',
    scenario: 'NF do fundo B por ID',
    table: 'notas_fiscais',
    id: fixtures.invoiceB.id,
    expectedVisible: false,
    blocker: 'acesso cruzado entre fundos',
  })
  await recordVisibility(cases, gestorB, {
    actor: 'gestor_b',
    scenario: 'fundo A nao autorizado',
    table: 'fundos',
    id: fixtures.fundA.id,
    expectedVisible: false,
    blocker: 'acesso cruzado entre fundos',
  })
  await recordVisibility(cases, consultorA, {
    actor: 'consultor_a',
    scenario: 'cedente exclusivo do consultor B',
    table: 'cedentes',
    id: fixtures.cedenteB.id,
    expectedVisible: false,
    blocker: 'acesso cruzado entre consultores',
  })
  await recordVisibility(cases, consultorA, {
    actor: 'consultor_a',
    scenario: 'NF exclusiva do fundo/carteira B',
    table: 'notas_fiscais',
    id: fixtures.invoiceB.id,
    expectedVisible: false,
    blocker: 'acesso cruzado entre consultores',
  })
  await recordVisibility(cases, cedenteA, {
    actor: 'cedente_a',
    scenario: 'NF de outro cedente',
    table: 'notas_fiscais',
    id: fixtures.invoiceB.id,
    expectedVisible: false,
    blocker: 'acesso cruzado entre cedentes',
  })
  await recordVisibility(cases, sacadoA, {
    actor: 'sacado_a',
    scenario: 'NF destinada a outro CNPJ',
    table: 'notas_fiscais',
    id: fixtures.invoiceSacadoB.id,
    expectedVisible: false,
    blocker: 'sacado acessando NF de outro CNPJ',
  })

  for (const session of [gestorA, gestorB, consultorA, cedenteA, sacadoA]) {
    await session.client.auth.signOut()
  }

  const blockers = cases.filter((testCase) => !testCase.passed && testCase.blocker)
  const evidencePath = resolve(
    getPerf9aLocalDir('evidence'),
    `rls-${env.projectRef}-${new Date().toISOString().replaceAll(':', '-')}.json`,
  )
  writeRestrictedJson(evidencePath, {
    projectRef: env.projectRef,
    executedAt: new Date().toISOString(),
    aal: 'aal2',
    cases,
    blockers: blockers.map(({ actor, scenario, blocker }) => ({ actor, scenario, blocker })),
  })

  printResults(cases)
  console.log(`\nEvidencia local restrita: ${evidencePath}`)

  if (blockers.length > 0) {
    console.error(`\nBLOQUEADOR CRITICO: ${blockers.length} falha(s) de isolamento confirmada(s).`)
    process.exitCode = 2
  }
}

async function createAal2Client(env, anonKey, credential) {
  const client = createClient(env.supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
  const { error: signInError } = await client.auth.signInWithPassword({
    email: credential.email,
    password: credential.password,
  })
  if (signInError) throw new Error(`Falha de login para ${credential.key}: ${signInError.message}`)

  const { data: before, error: beforeError } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  if (beforeError) throw new Error(`Falha ao obter AAL inicial de ${credential.key}: ${beforeError.message}`)

  if (before.currentLevel !== 'aal2') {
    const { data: factors, error: factorsError } = await client.auth.mfa.listFactors()
    if (factorsError) throw new Error(`Falha ao listar MFA de ${credential.key}: ${factorsError.message}`)
    const factor = factors.totp.find((item) => item.status === 'verified')
    if (!factor) throw new Error(`Fator TOTP verificado ausente para ${credential.key}.`)
    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: generateTotp(credential.totpSecret),
    })
    if (verifyError) throw new Error(`Falha ao elevar ${credential.key} para AAL2: ${verifyError.message}`)
  }

  const { data: after, error: afterError } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  if (afterError || after.currentLevel !== 'aal2') {
    throw new Error(`Sessao ${credential.key} nao atingiu AAL2.`)
  }

  return {
    key: credential.key,
    client,
    aalBefore: before.currentLevel,
    aalAfter: after.currentLevel,
  }
}

async function loadFixtures(admin) {
  const { data: funds, error: fundsError } = await admin
    .from('fundos')
    .select('id,nome')
    .ilike('nome', `${PERF9A_PREFIX}%`)
  if (fundsError || funds?.length !== 2) throw new Error(`Fundos PERF9A invalidos: ${fundsError?.message || funds?.length}`)
  const fundA = funds.find((fund) => fund.nome === `${PERF9A_PREFIX}FUNDO A`)
  const fundB = funds.find((fund) => fund.nome === `${PERF9A_PREFIX}FUNDO B`)
  if (!fundA || !fundB) throw new Error('Fundos A/B nao encontrados.')

  const { data: cedentes, error: cedentesError } = await admin
    .from('cedentes')
    .select('id,razao_social')
    .in('razao_social', [`${PERF9A_PREFIX}CEDENTE A 1`, `${PERF9A_PREFIX}CEDENTE B 61`])
  if (cedentesError) throw new Error(`Falha ao carregar cedentes de controle: ${cedentesError.message}`)
  const cedenteB = cedentes.find((cedente) => cedente.razao_social === `${PERF9A_PREFIX}CEDENTE B 61`)
  if (!cedenteB) throw new Error('Cedente B de controle ausente.')

  const { data: fundBLink, error: linkError } = await admin
    .from('cedente_fundos')
    .select('id')
    .eq('cedente_id', cedenteB.id)
    .eq('fundo_id', fundB.id)
    .eq('status', 'ativo')
    .single()
  if (linkError) throw new Error(`Vinculo B ausente: ${linkError.message}`)

  const { data: operations, error: operationsError } = await admin
    .from('operacoes')
    .select('id,cedente_fundo_id')
    .eq('cedente_fundo_id', fundBLink.id)
    .limit(1)
  if (operationsError || !operations?.[0]) throw new Error(`Operacao B ausente: ${operationsError?.message || 'sem linha'}`)

  const { data: invoices, error: invoicesError } = await admin
    .from('notas_fiscais')
    .select('id,fundo_id,cnpj_destinatario')
    .eq('fundo_id', fundB.id)
    .limit(20)
  if (invoicesError || !invoices?.length) throw new Error(`NFs B ausentes: ${invoicesError?.message || 'sem linha'}`)

  const { data: sacadoA, error: sacadoError } = await admin
    .from('sacados')
    .select('cnpj')
    .eq('razao_social', `${PERF9A_PREFIX}SACADO A`)
    .single()
  if (sacadoError) throw new Error(`Sacado A ausente: ${sacadoError.message}`)
  const invoiceSacadoB = invoices.find((invoice) => invoice.cnpj_destinatario !== sacadoA.cnpj)
  if (!invoiceSacadoB) throw new Error('NF destinada ao Sacado B ausente.')

  return {
    fundA,
    fundB,
    cedenteB,
    operationB: operations[0],
    invoiceB: invoices[0],
    invoiceSacadoB,
  }
}

async function recordVisibility(cases, session, scenario) {
  const startedAt = performance.now()
  const { data, error } = await session.client
    .from(scenario.table)
    .select('id')
    .eq('id', scenario.id)
    .limit(1)
  const visible = Boolean(data?.length)
  const obtained = error ? `erro:${error.code || 'desconhecido'}` : visible ? 'visivel' : 'oculto'
  const expected = scenario.expectedVisible ? 'visivel' : 'oculto'
  cases.push({
    actor: scenario.actor,
    aalBefore: session.aalBefore,
    aalAfter: session.aalAfter,
    scenario: scenario.scenario,
    table: scenario.table,
    expected,
    obtained,
    passed: !error && visible === scenario.expectedVisible,
    blocker: scenario.blocker || null,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
  })
}

function printResults(cases) {
  for (const testCase of cases) {
    const marker = testCase.passed ? 'OK' : 'FALHA'
    console.log(
      `- [${marker}] ${testCase.actor} | ${testCase.scenario} | `
      + `esperado=${testCase.expected} obtido=${testCase.obtained} | ${testCase.durationMs} ms`,
    )
  }
}

function requireCredential(users, key) {
  const credential = users.get(key)
  if (!credential) throw new Error(`Credencial local ausente para ${key}.`)
  return credential
}

function safeError(error) {
  if (!(error instanceof Error)) return String(error)
  return error.message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://***')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>')
}
