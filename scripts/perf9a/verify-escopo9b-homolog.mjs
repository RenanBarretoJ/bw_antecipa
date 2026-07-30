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
    console.error(`\nVerificacao Escopo 9B falhou: ${safeError(error)}\n`)
    process.exitCode = 1
  }
}

async function main() {
  loadEnvFile(args['env-file'])
  const env = assertHomologEnvironment()
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY ausente.')

  console.log('\nBW Antecipa - verificacao autenticada Escopo 9B')
  printEnvironmentSummary(env)

  const credentialsPath = resolve(
    getPerf9aLocalDir('credentials'),
    `users-${env.projectRef}.json`,
  )
  const credentialFile = JSON.parse(readFileSync(credentialsPath, 'utf8'))
  const users = new Map(credentialFile.users.map((user) => [user.key, user]))
  const admin = createAdminClient(env)
  const fixtures = await loadFixtures(admin)
  const cases = []

  const sessions = {}
  for (const key of [
    'gestor_a', 'gestor_b', 'gestor_multi',
    'consultor_a', 'consultor_b', 'cedente_a', 'sacado_a',
  ]) {
    sessions[key] = await createAal2Client(env, anonKey, requireCredential(users, key))
  }

  const visibility = [
    ['gestor_a', 'fundo A autorizado', 'fundos', fixtures.fundA.id, true],
    ['gestor_a', 'fundo B nao autorizado', 'fundos', fixtures.fundB.id, false],
    ['gestor_a', 'vinculo A autorizado', 'cedente_fundos', fixtures.linkA.id, true],
    ['gestor_a', 'vinculo B nao autorizado', 'cedente_fundos', fixtures.linkB.id, false],
    ['gestor_a', 'operacao A autorizada', 'operacoes', fixtures.operationA.id, true],
    ['gestor_a', 'operacao B nao autorizada', 'operacoes', fixtures.operationB.id, false],
    ['gestor_a', 'NF A autorizada', 'notas_fiscais', fixtures.invoiceA.id, true],
    ['gestor_a', 'NF B nao autorizada', 'notas_fiscais', fixtures.invoiceB.id, false],
    ['gestor_a', 'relacao operacao-NF A autorizada', 'operacoes_nfs', fixtures.operationNfA, true],
    ['gestor_a', 'relacao operacao-NF B nao autorizada', 'operacoes_nfs', fixtures.operationNfB, false],
    ['gestor_a', 'vinculo usuario do fundo A', 'usuario_fundos', fixtures.userFundA.id, true],
    ['gestor_a', 'vinculo usuario do fundo B', 'usuario_fundos', fixtures.userFundB.id, false],
    ['gestor_b', 'fundo B autorizado', 'fundos', fixtures.fundB.id, true],
    ['gestor_b', 'fundo A nao autorizado', 'fundos', fixtures.fundA.id, false],
    ['gestor_b', 'operacao B autorizada', 'operacoes', fixtures.operationB.id, true],
    ['gestor_b', 'operacao A nao autorizada', 'operacoes', fixtures.operationA.id, false],
    ['gestor_b', 'NF B autorizada', 'notas_fiscais', fixtures.invoiceB.id, true],
    ['gestor_b', 'NF A nao autorizada', 'notas_fiscais', fixtures.invoiceA.id, false],
    ['gestor_multi', 'gestor multi fundo A', 'fundos', fixtures.fundA.id, true],
    ['gestor_multi', 'gestor multi fundo B', 'fundos', fixtures.fundB.id, true],
    ['gestor_multi', 'gestor multi operacao A', 'operacoes', fixtures.operationA.id, true],
    ['gestor_multi', 'gestor multi operacao B', 'operacoes', fixtures.operationB.id, true],
    ['gestor_multi', 'gestor multi NF A', 'notas_fiscais', fixtures.invoiceA.id, true],
    ['gestor_multi', 'gestor multi NF B', 'notas_fiscais', fixtures.invoiceB.id, true],
    ['consultor_a', 'cedente A na carteira', 'cedentes', fixtures.cedenteA.id, true],
    ['consultor_a', 'cedente B fora da carteira', 'cedentes', fixtures.cedenteB.id, false],
    ['consultor_a', 'vinculo A na carteira', 'cedente_fundos', fixtures.linkA.id, true],
    ['consultor_a', 'vinculo B fora da carteira', 'cedente_fundos', fixtures.linkB.id, false],
    ['consultor_a', 'NF A na carteira', 'notas_fiscais', fixtures.invoiceA.id, true],
    ['consultor_a', 'NF B fora da carteira', 'notas_fiscais', fixtures.invoiceB.id, false],
    ['consultor_a', 'operacao A na carteira', 'operacoes', fixtures.operationA.id, true],
    ['consultor_a', 'operacao B fora da carteira', 'operacoes', fixtures.operationB.id, false],
    ['consultor_b', 'cedente B na carteira', 'cedentes', fixtures.cedenteB.id, true],
    ['consultor_b', 'cedente A fora da carteira', 'cedentes', fixtures.cedenteA.id, false],
    ['consultor_b', 'NF B na carteira', 'notas_fiscais', fixtures.invoiceB.id, true],
    ['consultor_b', 'NF A fora da carteira', 'notas_fiscais', fixtures.invoiceA.id, false],
    ['cedente_a', 'cedente ve a propria NF', 'notas_fiscais', fixtures.invoiceA.id, true],
    ['cedente_a', 'cedente nao ve NF de outro cedente', 'notas_fiscais', fixtures.invoiceB.id, false],
    ['sacado_a', 'sacado ve NF do proprio CNPJ', 'notas_fiscais', fixtures.invoiceSacadoA.id, true],
    ['sacado_a', 'sacado nao ve NF de outro CNPJ', 'notas_fiscais', fixtures.invoiceSacadoB.id, false],
  ]
  for (const [actor, scenario, table, id, expectedVisible] of visibility) {
    const filters = typeof id === 'object' ? id : null
    await recordVisibility(cases, sessions[actor], { actor, scenario, table, id: filters ? null : id, filters, expectedVisible })
  }

  await recordWrite(cases, sessions.gestor_a, {
    actor: 'gestor_a', scenario: 'nao atualiza operacao B por ID', table: 'operacoes', id: fixtures.operationB.id,
    update: { updated_at: fixtures.operationB.updated_at }, expectedBlocked: true,
  })
  await recordWrite(cases, sessions.gestor_a, {
    actor: 'gestor_a', scenario: 'nao move operacao A para fundo B', table: 'operacoes', id: fixtures.operationA.id,
    update: { cedente_fundo_id: fixtures.linkB.id }, expectedBlocked: true,
    restore: { cedente_fundo_id: fixtures.linkA.id }, admin,
  })
  await recordWrite(cases, sessions.gestor_a, {
    actor: 'gestor_a', scenario: 'nao move NF A para fundo B', table: 'notas_fiscais', id: fixtures.invoiceA.id,
    update: { fundo_id: fixtures.fundB.id, cedente_fundo_id: fixtures.linkB.id }, expectedBlocked: true,
    restore: { fundo_id: fixtures.fundA.id, cedente_fundo_id: fixtures.linkA.id }, admin,
  })
  await recordWrite(cases, sessions.consultor_a, {
    actor: 'consultor_a', scenario: 'nao altera NF da carteira', table: 'notas_fiscais', id: fixtures.invoiceA.id,
    update: { updated_at: fixtures.invoiceA.updated_at }, expectedBlocked: true,
  })
  await recordWrite(cases, sessions.consultor_a, {
    actor: 'consultor_a', scenario: 'nao altera carteira do consultor B', table: 'consultor_cedente', id: fixtures.consultorLinkB.id,
    update: { comissao_percentual: fixtures.consultorLinkB.comissao_percentual }, expectedBlocked: true,
  })

  await recordRpc(cases, sessions.gestor_a, {
    actor: 'gestor_a', scenario: 'dashboard gestor rejeita fundo B', functionName: 'dashboard_gestor_resumo',
    args: { p_fundo_id: fixtures.fundB.id }, forbiddenMarker: fixtures.fundB.id,
  })
  await recordRpc(cases, sessions.gestor_a, {
    actor: 'gestor_a', scenario: 'relatorio gestor rejeita fundo B', functionName: 'relatorio_gestor_analitico',
    args: { p_fundo_id: fixtures.fundB.id, p_mes: '2026-07' }, forbiddenMarker: fixtures.fundB.id,
  })
  await recordRpc(cases, sessions.gestor_a, {
    actor: 'gestor_a', scenario: 'onboarding rejeita fundo B', functionName: 'listar_onboarding_cedentes_paginado',
    args: { p_fundo_id: fixtures.fundB.id }, forbiddenMarker: fixtures.fundB.id,
  })
  await recordRpc(cases, sessions.consultor_a, {
    actor: 'consultor_a', scenario: 'dashboard consultor nao retorna cedente B', functionName: 'dashboard_consultor_resumo',
    args: {}, forbiddenMarker: fixtures.cedenteB.id,
  })
  await recordRpc(cases, sessions.consultor_a, {
    actor: 'consultor_a', scenario: 'relatorio consultor nao retorna cedente B', functionName: 'relatorio_consultor_analitico',
    args: { p_mes: '2026-07' }, forbiddenMarker: fixtures.cedenteB.id,
  })

  for (const session of Object.values(sessions)) await session.client.auth.signOut()

  const failures = cases.filter((testCase) => !testCase.passed)
  const evidencePath = resolve(
    getPerf9aLocalDir('evidence'),
    `rls-escopo9b-${env.projectRef}-${new Date().toISOString().replaceAll(':', '-')}.json`,
  )
  writeRestrictedJson(evidencePath, {
    projectRef: env.projectRef,
    executedAt: new Date().toISOString(),
    scope: '9B',
    aal: 'aal2',
    cases,
    failures: failures.map(({ actor, scenario, table, expected, obtained }) => ({ actor, scenario, table, expected, obtained })),
  })

  printResults(cases)
  console.log(`\nEvidencia local restrita: ${evidencePath}`)
  if (failures.length > 0) {
    console.error(`\nFALHA DE ISOLAMENTO: ${failures.length} caso(s).`)
    process.exitCode = 2
  }
}

async function createAal2Client(env, anonKey, credential) {
  const client = createClient(env.supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } })
  const { error: signInError } = await client.auth.signInWithPassword({ email: credential.email, password: credential.password })
  if (signInError) throw new Error(`Falha de login para ${credential.key}: ${signInError.message}`)
  const { data: before, error: beforeError } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  if (beforeError) throw new Error(`Falha ao obter AAL de ${credential.key}: ${beforeError.message}`)
  if (before.currentLevel !== 'aal2') {
    const { data: factors, error: factorsError } = await client.auth.mfa.listFactors()
    if (factorsError) throw new Error(`Falha ao listar MFA de ${credential.key}: ${factorsError.message}`)
    const factor = factors.totp.find((item) => item.status === 'verified')
    if (!factor) throw new Error(`Fator TOTP ausente para ${credential.key}.`)
    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: generateTotp(credential.totpSecret) })
    if (verifyError) throw new Error(`Falha ao elevar ${credential.key}: ${verifyError.message}`)
  }
  const { data: after, error: afterError } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  if (afterError || after.currentLevel !== 'aal2') throw new Error(`Sessao ${credential.key} nao atingiu AAL2.`)
  return { key: credential.key, client, aalBefore: before.currentLevel, aalAfter: after.currentLevel }
}

async function loadFixtures(admin) {
  const { data: funds, error: fundsError } = await admin.from('fundos').select('id,nome').in('nome', [`${PERF9A_PREFIX}FUNDO A`, `${PERF9A_PREFIX}FUNDO B`])
  if (fundsError || funds?.length !== 2) throw new Error(`Fundos PERF9A invalidos: ${fundsError?.message || funds?.length}`)
  const fundA = funds.find((item) => item.nome === `${PERF9A_PREFIX}FUNDO A`)
  const fundB = funds.find((item) => item.nome === `${PERF9A_PREFIX}FUNDO B`)
  const { data: cedentes, error: cedentesError } = await admin.from('cedentes').select('id,razao_social').in('razao_social', [`${PERF9A_PREFIX}CEDENTE A 1`, `${PERF9A_PREFIX}CEDENTE B 61`])
  if (cedentesError || cedentes?.length !== 2) throw new Error(`Cedentes PERF9A invalidos: ${cedentesError?.message || cedentes?.length}`)
  const cedenteA = cedentes.find((item) => item.razao_social === `${PERF9A_PREFIX}CEDENTE A 1`)
  const cedenteB = cedentes.find((item) => item.razao_social === `${PERF9A_PREFIX}CEDENTE B 61`)
  const getLink = async (cedenteId, fundoId) => {
    const { data, error } = await admin.from('cedente_fundos').select('id,cedente_id,fundo_id').eq('cedente_id', cedenteId).eq('fundo_id', fundoId).eq('status', 'ativo').single()
    if (error) throw new Error(`Vinculo PERF9A ausente: ${error.message}`)
    return data
  }
  const linkA = await getLink(cedenteA.id, fundA.id)
  const linkB = await getLink(cedenteB.id, fundB.id)
  const getOperation = async (link) => {
    const { data, error } = await admin.from('operacoes').select('id,cedente_id,cedente_fundo_id,updated_at').eq('cedente_fundo_id', link.id).limit(1).single()
    if (error) throw new Error(`Operacao PERF9A ausente: ${error.message}`)
    return data
  }
  const operationA = await getOperation(linkA)
  const operationB = await getOperation(linkB)
  const getInvoice = async (fundoId, link) => {
    const { data, error } = await admin.from('notas_fiscais').select('id,fundo_id,cedente_fundo_id,cedente_id,cnpj_destinatario,updated_at').eq('fundo_id', fundoId).eq('cedente_fundo_id', link.id).limit(1).single()
    if (error) throw new Error(`NF PERF9A ausente: ${error.message}`)
    return data
  }
  const invoiceA = await getInvoice(fundA.id, linkA)
  const invoiceB = await getInvoice(fundB.id, linkB)
  const getOpNf = async (operationId) => {
    const { data, error } = await admin.from('operacoes_nfs').select('operacao_id,nota_fiscal_id').eq('operacao_id', operationId).limit(1).single()
    if (error) throw new Error(`Relacao operacao-NF PERF9A ausente: ${error.message}`)
    return data
  }
  const operationNfA = await getOpNf(operationA.id)
  const operationNfB = await getOpNf(operationB.id)
  const { data: userFunds, error: userFundsError } = await admin.from('usuario_fundos').select('id,usuario_id,fundo_id').in('fundo_id', [fundA.id, fundB.id]).eq('status', 'ativo')
  if (userFundsError) throw new Error(`Vinculos de usuario PERF9A ausentes: ${userFundsError.message}`)
  const userFundA = userFunds.find((item) => item.fundo_id === fundA.id)
  const userFundB = userFunds.find((item) => item.fundo_id === fundB.id)
  const { data: consultantLinks, error: consultantError } = await admin.from('consultor_cedente').select('id,consultor_id,cedente_id,comissao_percentual').in('cedente_id', [cedenteA.id, cedenteB.id])
  if (consultantError) throw new Error(`Carteira PERF9A ausente: ${consultantError.message}`)
  const consultorLinkB = consultantLinks.find((item) => item.cedente_id === cedenteB.id)
  const { data: sacados, error: sacadosError } = await admin.from('sacados').select('cnpj,razao_social').in('razao_social', [`${PERF9A_PREFIX}SACADO A`, `${PERF9A_PREFIX}SACADO B`])
  if (sacadosError || sacados?.length !== 2) throw new Error(`Sacados PERF9A invalidos: ${sacadosError?.message || sacados?.length}`)
  const invoiceSacadoA = await findInvoiceByCnpj(admin, sacados.find((item) => item.razao_social === `${PERF9A_PREFIX}SACADO A`).cnpj)
  const invoiceSacadoB = await findInvoiceByCnpj(admin, sacados.find((item) => item.razao_social === `${PERF9A_PREFIX}SACADO B`).cnpj)
  return { fundA, fundB, cedenteA, cedenteB, linkA, linkB, operationA, operationB, invoiceA, invoiceB, operationNfA, operationNfB, userFundA, userFundB, consultorLinkB, invoiceSacadoA, invoiceSacadoB }
}

async function findInvoiceByCnpj(admin, cnpj) {
  const { data, error } = await admin.from('notas_fiscais').select('id,fundo_id,cedente_fundo_id,cedente_id,cnpj_destinatario,updated_at').eq('cnpj_destinatario', cnpj).limit(1).single()
  if (error) throw new Error(`NF por sacado PERF9A ausente: ${error.message}`)
  return data
}

async function recordVisibility(cases, session, scenario) {
  const startedAt = performance.now()
  let query = session.client.from(scenario.table).select('*')
  if (scenario.filters) {
    for (const [column, value] of Object.entries(scenario.filters)) query = query.eq(column, value)
  } else {
    query = query.eq('id', scenario.id)
  }
  const { data, error } = await query.limit(1)
  const visible = Boolean(data?.length)
  cases.push({ actor: scenario.actor, aalBefore: session.aalBefore, aalAfter: session.aalAfter, kind: 'select', scenario: scenario.scenario, table: scenario.table, expected: scenario.expectedVisible ? 'visivel' : 'oculto', obtained: error ? `erro:${error.code || 'desconhecido'}` : visible ? 'visivel' : 'oculto', passed: !error && visible === scenario.expectedVisible, durationMs: Number((performance.now() - startedAt).toFixed(2)) })
}

async function recordWrite(cases, session, scenario) {
  const startedAt = performance.now()
  const { data, error } = await session.client.from(scenario.table).update(scenario.update).eq('id', scenario.id).select('id')
  const blocked = Boolean(error) || !data?.length
  if (data?.length && scenario.restore && scenario.admin) await scenario.admin.from(scenario.table).update(scenario.restore).eq('id', scenario.id)
  cases.push({ actor: scenario.actor, aalBefore: session.aalBefore, aalAfter: session.aalAfter, kind: 'write', scenario: scenario.scenario, table: scenario.table, expected: 'bloqueado', obtained: error ? `erro:${error.code || 'desconhecido'}` : data?.length ? 'aceito' : 'sem_linha', passed: blocked === scenario.expectedBlocked, durationMs: Number((performance.now() - startedAt).toFixed(2)) })
}

async function recordRpc(cases, session, scenario) {
  const startedAt = performance.now()
  const { data, error } = await session.client.rpc(scenario.functionName, scenario.args)
  const serialized = JSON.stringify(data ?? '')
  const leaked = serialized.includes(scenario.forbiddenMarker)
  const blocked = Boolean(error) || !leaked
  cases.push({ actor: scenario.actor, aalBefore: session.aalBefore, aalAfter: session.aalAfter, kind: 'rpc', scenario: scenario.scenario, functionName: scenario.functionName, expected: 'sem_dados_cruzados', obtained: error ? `erro:${error.code || 'desconhecido'}` : leaked ? 'dados_cruzados' : 'sem_dados_cruzados', passed: blocked, durationMs: Number((performance.now() - startedAt).toFixed(2)) })
}

function printResults(cases) {
  for (const testCase of cases) console.log(`- [${testCase.passed ? 'OK' : 'FALHA'}] ${testCase.actor} | ${testCase.kind} | ${testCase.scenario} | ${testCase.obtained} | ${testCase.durationMs} ms`)
}

function requireCredential(users, key) {
  const credential = users.get(key)
  if (!credential) throw new Error(`Credencial local ausente para ${key}.`)
  return credential
}

function safeError(error) {
  if (!(error instanceof Error)) return String(error)
  return error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://***').replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>')
}
