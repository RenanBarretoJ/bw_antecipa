#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { generateTotp } from './dataset.mjs'
import {
  PERF9A_PREFIX,
  assertHomologEnvironment,
  createAdminClient,
  getPerf9aLocalDir,
  loadEnvFile,
  writeRestrictedJson,
} from './common.mjs'

const BASE_URL = 'http://localhost:3001'
const COLUMNS = ['termo_assinado_url', 'notificacao_assinada_url', 'comprovante_pagamento_url']
const TYPES = [
  'TERMO_CESSAO_ASSINADO',
  'NOTIFICACAO_SACADO_ASSINADA',
  'COMPROVANTE_DESEMBOLSO_TED',
]

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Homologacao de documentos assinados falhou: ${safeError(error)}`)
    process.exitCode = 1
  })
}

async function main() {
  loadEnvFile('.env.homolog')
  const env = assertHomologEnvironment()
  const admin = createAdminClient(env)
  const credentials = JSON.parse(readFileSync(
    resolve(getPerf9aLocalDir('credentials'), `users-${env.projectRef}.json`),
    'utf8',
  ))
  const users = new Map(credentials.users.map((user) => [user.key, user]))
  const fixture = await loadFixture(admin)
  const pathsCriados = new Set()

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    const gestorA = await authenticatedPage(browser, requireUser(users, 'gestor_a'))
    const gestorB = await authenticatedPage(browser, requireUser(users, 'gestor_b'))
    try {
      const uploads = []
      for (const tipo of TYPES) {
        uploads.push(await upload(gestorA.page, fixture.operacaoId, tipo))
        const current = await loadOperation(admin, fixture.operacaoId)
        for (const column of COLUMNS) if (current[column]) pathsCriados.add(current[column])
      }

      const replacement = await upload(gestorA.page, fixture.operacaoId, 'TERMO_CESSAO_ASSINADO')
      const current = await loadOperation(admin, fixture.operacaoId)
      for (const column of COLUMNS) if (current[column]) pathsCriados.add(current[column])

      const downloads = []
      for (const tipo of TYPES) downloads.push(await signedUrl(gestorA.page, fixture.operacaoId, tipo))
      const adversarialUpload = await upload(gestorB.page, fixture.operacaoId, 'TERMO_CESSAO_ASSINADO', false)
      const adversarialDownload = await signedUrl(gestorB.page, fixture.operacaoId, 'TERMO_CESSAO_ASSINADO', false)

      const { data: auditRows, error: auditError } = await admin
        .from('logs_auditoria')
        .select('tipo_evento')
        .eq('entidade_tipo', 'operacoes')
        .eq('entidade_id', fixture.operacaoId)
        .in('tipo_evento', ['DOCUMENTO_ASSINADO_ANEXADO', 'DOCUMENTO_ASSINADO_SUBSTITUIDO'])
      if (auditError) throw new Error(`Auditoria indisponivel: ${auditError.message}`)

      const passed = uploads.every((item) => item.status === 200 && item.body.success)
        && replacement.status === 200
        && replacement.body.replaced === true
        && downloads.every((item) => item.status === 200 && item.body.expiresIn === 60 && item.signedFetchStatus === 200)
        && [403, 404].includes(adversarialUpload.status)
        && [403, 404].includes(adversarialDownload.status)
        && (auditRows || []).some((item) => item.tipo_evento === 'DOCUMENTO_ASSINADO_SUBSTITUIDO')

      const evidence = {
        scope: 'documentos-assinados-operacao',
        projectRef: env.projectRef,
        executedAt: new Date().toISOString(),
        operationId: fixture.operacaoId,
        uploads: uploads.map(safeResult),
        replacement: safeResult(replacement),
        downloads: downloads.map(({ status, body, signedFetchStatus }) => ({ status, expiresIn: body.expiresIn, signedFetchStatus })),
        adversarialUpload: safeResult(adversarialUpload),
        adversarialDownload: safeResult(adversarialDownload),
        auditEvents: (auditRows || []).map((item) => item.tipo_evento),
        status: passed ? 'APROVADO' : 'NO-GO',
      }
      const evidencePath = resolve(
        getPerf9aLocalDir('evidence'),
        `documentos-assinados-operacao-${env.projectRef}-${new Date().toISOString().replaceAll(':', '-')}.json`,
      )
      writeRestrictedJson(evidencePath, evidence)
      console.log(`Documentos assinados da operacao: ${evidence.status}`)
      console.log(`- uploads autorizados: ${uploads.filter((item) => item.status === 200).length}/${TYPES.length}`)
      console.log(`- substituicao autorizada: ${replacement.status === 200 ? 'OK' : 'FALHA'}`)
      console.log(`- gestor adversario bloqueado: ${[403, 404].includes(adversarialUpload.status) ? 'OK' : 'FALHA'}`)
      console.log(`- URLs temporarias: ${downloads.filter((item) => item.body.expiresIn === 60).length}/${TYPES.length}`)
      console.log(`Evidencia local restrita: ${evidencePath}`)
      if (!passed) process.exitCode = 1
    } finally {
      await gestorA.context.close()
      await gestorB.context.close()
    }
  } finally {
    await admin.from('operacoes').update({
      termo_assinado_url: null,
      notificacao_assinada_url: null,
      comprovante_pagamento_url: null,
    }).eq('id', fixture.operacaoId)
    if (pathsCriados.size > 0) await admin.storage.from('contratos').remove([...pathsCriados])
    await browser.close()
  }
}

async function loadFixture(admin) {
  const { data: fund, error: fundError } = await admin.from('fundos').select('id').eq('nome', `${PERF9A_PREFIX}FUNDO A`).single()
  if (fundError) throw new Error(`Fundo PERF9A A ausente: ${fundError.message}`)
  const { data: link, error: linkError } = await admin.from('cedente_fundos').select('id').eq('fundo_id', fund.id).eq('status', 'ativo').limit(1).single()
  if (linkError) throw new Error(`Vinculo PERF9A A ausente: ${linkError.message}`)
  const { data: operation, error: operationError } = await admin
    .from('operacoes')
    .select(`id,${COLUMNS.join(',')}`)
    .eq('cedente_fundo_id', link.id)
    .limit(1)
    .single()
  if (operationError) throw new Error(`Operacao PERF9A A ausente: ${operationError.message}`)
  if (COLUMNS.some((column) => operation[column])) {
    throw new Error('A operacao PERF9A selecionada ja possui documentos; homologacao cancelada para preservar dados.')
  }
  return { operacaoId: operation.id }
}

async function loadOperation(admin, operationId) {
  const { data, error } = await admin.from('operacoes').select(COLUMNS.join(',')).eq('id', operationId).single()
  if (error) throw new Error(error.message)
  return data
}

async function authenticatedPage(browser, user) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 45_000 })
  await page.type('#email', user.email)
  await page.type('#password', user.password)
  await Promise.all([
    page.waitForFunction(() => !window.location.pathname.endsWith('/login'), { timeout: 45_000 }),
    page.click('button[type="submit"]'),
  ])
  if (new URL(page.url()).pathname === '/mfa/desafio') {
    await page.waitForSelector('input[name="code"]', { timeout: 45_000 })
    await page.type('input[name="code"]', generateTotp(user.totpSecret))
    await Promise.all([
      page.waitForFunction(() => !window.location.pathname.endsWith('/mfa/desafio'), { timeout: 45_000 }),
      page.click('form button[type="submit"]'),
    ])
  }
  return { context, page }
}

async function upload(page, operationId, tipoDocumento, expectSuccess = true) {
  const result = await page.evaluate(async ({ operationId, tipoDocumento }) => {
    const data = new FormData()
    data.set('tipoDocumento', tipoDocumento)
    data.set('arquivo', new File(['%PDF-1.7\n% PERF9A\n'], '../nome-controlado-pelo-cliente.pdf', { type: 'application/pdf' }))
    const response = await fetch(`/api/operacoes/${operationId}/documentos-assinados`, { method: 'POST', body: data })
    return { status: response.status, body: await response.json() }
  }, { operationId, tipoDocumento })
  if (expectSuccess && result.status !== 200) throw new Error(`Upload ${tipoDocumento} falhou com HTTP ${result.status}: ${result.body?.message}`)
  return result
}

async function signedUrl(page, operationId, tipoDocumento, expectSuccess = true) {
  const result = await page.evaluate(async ({ operationId, tipoDocumento }) => {
    const response = await fetch(`/api/operacoes/${operationId}/documentos-assinados?tipoDocumento=${encodeURIComponent(tipoDocumento)}`)
    return { status: response.status, body: await response.json() }
  }, { operationId, tipoDocumento })
  if (expectSuccess && result.status !== 200) throw new Error(`URL ${tipoDocumento} falhou com HTTP ${result.status}: ${result.body?.message}`)
  const signedFetchStatus = result.body?.url ? (await fetch(result.body.url)).status : null
  return { ...result, signedFetchStatus }
}

function requireUser(users, key) {
  const user = users.get(key)
  if (!user) throw new Error(`Credencial PERF9A ausente: ${key}`)
  return user
}

function safeResult(result) {
  return { status: result.status, success: Boolean(result.body?.success), code: result.body?.code || null, replaced: Boolean(result.body?.replaced) }
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error)).replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>')
}
