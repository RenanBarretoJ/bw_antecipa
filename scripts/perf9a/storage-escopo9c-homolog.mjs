#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  assertHomologEnvironment,
  createAdminClient,
  getPerf9aLocalDir,
  loadEnvFile,
  writeRestrictedJson,
} from './common.mjs'

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main()
  } catch (error) {
    console.error(`Storage Escopo 9C falhou: ${safeError(error)}`)
    process.exitCode = 1
  }
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
  const fixtures = await carregarFixtures(admin, users)
  const createdObjects = []

  try {
    for (const fixture of Object.values(fixtures)) {
      if (await garantirObjeto(admin, fixture)) createdObjects.push(fixture)
    }

    const cases = [
      ['gestor_a', fixtures.documentoA, true, 'gestor A / documento A'],
      ['gestor_a', fixtures.documentoB, false, 'gestor A / documento B'],
      ['gestor_b', fixtures.documentoB, true, 'gestor B / documento B'],
      ['gestor_b', fixtures.documentoA, false, 'gestor B / documento A'],
      ['gestor_multi', fixtures.documentoA, true, 'gestor multi / documento A'],
      ['gestor_multi', fixtures.documentoB, true, 'gestor multi / documento B'],
      ['cedente_a', fixtures.documentoA, true, 'cedente A / documento proprio'],
      ['cedente_a', fixtures.documentoB, false, 'cedente A / documento B'],
      ['consultor_a', fixtures.documentoA, true, 'consultor A / carteira A'],
      ['consultor_a', fixtures.documentoB, false, 'consultor A / carteira B'],
      ['sacado_a', fixtures.notaSacadoA, true, 'sacado A / NF propria'],
      ['sacado_a', fixtures.notaSacadoB, false, 'sacado A / NF de outro CNPJ'],
      [null, fixtures.documentoA, false, 'anonimo / documento A'],
      ['gestor_a', { ...fixtures.documentoA, path: `${fixtures.documentoA.path}.manipulado` }, false, 'caminho manipulado'],
      ['gestor_a', { ...fixtures.documentoA, path: `../${fixtures.documentoA.path}` }, false, 'path traversal'],
      ['gestor_a', { ...fixtures.documentoA, path: `%2e%2e%2f${fixtures.documentoA.path}` }, false, 'path traversal codificado'],
      ['gestor_a', { ...fixtures.documentoA, path: `${fixtures.documentoA.path}-prefixo-semelhante` }, false, 'prefixo semelhante'],
      ['gestor_a', { bucket: 'documentos-v2', path: 'inexistente/arquivo.pdf' }, false, 'objeto inexistente'],
    ]

    const results = []
    for (const [userKey, fixture, expected, label] of cases) {
      results.push(await testarAcesso(env, users.get(userKey), fixture, expected, label))
    }

    const expiration = await testarExpiracao(env, users.get('gestor_a'), fixtures.documentoA)
    const approved = results.every((result) => result.passed) && expiration.passed
    const evidence = {
      scope: '9C',
      gate: 'storage-authorization-matrix',
      projectRef: env.projectRef,
      executedAt: new Date().toISOString(),
      cases: results,
      expiration,
      status: approved ? 'APROVADO' : 'NO-GO',
    }
    const evidencePath = resolve(
      getPerf9aLocalDir('evidence'),
      `storage-escopo9c-${env.projectRef}-${new Date().toISOString().replaceAll(':', '-')}.json`,
    )
    writeRestrictedJson(evidencePath, evidence)
    console.log(`Storage Escopo 9C: ${evidence.status}`)
    for (const result of results) console.log(`- [${result.passed ? 'OK' : 'FALHA'}] ${result.label}`)
    console.log(`- [${expiration.passed ? 'OK' : 'FALHA'}] expiracao da URL assinada`)
    console.log(`Evidencia local restrita: ${evidencePath}`)
    if (!approved) process.exitCode = 1
  } finally {
    for (const fixture of createdObjects) {
      await admin.storage.from(fixture.bucket).remove([fixture.path])
    }
  }
}

async function carregarFixtures(admin, users) {
  const cedenteA = await linha(admin.from('cedentes').select('id').eq('user_id', users.get('cedente_a').id).maybeSingle(), 'cedente A')
  const cedenteB = await linha(admin.from('cedentes').select('id').eq('user_id', users.get('cedente_b').id).maybeSingle(), 'cedente B')
  const documentoA = await documentoDoCedente(admin, cedenteA.id)
  const documentoB = await documentoDoCedente(admin, cedenteB.id)

  const sacadoA = await linha(admin.from('sacados').select('cnpj').eq('user_id', users.get('sacado_a').id).maybeSingle(), 'sacado A')
  const sacadoB = await linha(admin.from('sacados').select('cnpj').eq('user_id', users.get('sacado_b').id).maybeSingle(), 'sacado B')
  const notaSacadoA = await notaDoSacado(admin, sacadoA.cnpj)
  const notaSacadoB = await notaDoSacado(admin, sacadoB.cnpj)
  return { documentoA, documentoB, notaSacadoA, notaSacadoB }
}

async function documentoDoCedente(admin, cedenteId) {
  const links = await linhas(admin.from('documento_vinculos')
    .select('documento_id,nota_fiscal_id')
    .eq('cedente_id', cedenteId)
    .not('nota_fiscal_id', 'is', null)
    .limit(100), 'vinculos documentais')
  for (const link of links) {
    const version = await optional(admin.from('documento_versoes')
      .select('bucket,path')
      .eq('documento_id', link.documento_id)
      .order('numero_versao', { ascending: false })
      .limit(1)
      .maybeSingle())
    if (version?.bucket === 'documentos-v2' && version.path) return version
  }
  throw new Error('Fixture documental PERF9A nao encontrada para o cedente.')
}

async function notaDoSacado(admin, cnpj) {
  const digits = String(cnpj).replace(/\D/g, '')
  const candidates = await linhas(admin.from('notas_fiscais')
    .select('arquivo_url,cnpj_destinatario')
    .not('arquivo_url', 'is', null)
    .limit(2000), 'NFs PERF9A')
  const nota = candidates.find((row) => String(row.cnpj_destinatario).replace(/\D/g, '') === digits)
  if (!nota?.arquivo_url) throw new Error('Fixture de NF PERF9A nao encontrada para o sacado.')
  return { bucket: 'notas-fiscais', path: nota.arquivo_url }
}

async function garantirObjeto(admin, fixture) {
  const existing = await admin.storage.from(fixture.bucket).download(fixture.path)
  if (!existing.error) return false
  const upload = await admin.storage.from(fixture.bucket).upload(
    fixture.path,
    new TextEncoder().encode('BW Antecipa PERF9A Escopo 9C'),
    { contentType: 'application/octet-stream', upsert: false },
  )
  if (upload.error) throw new Error(`Nao foi possivel preparar objeto de teste: ${upload.error.message}`)
  return true
}

async function testarAcesso(env, user, fixture, expected, label) {
  const client = criarCliente(env)
  if (user) {
    const signIn = await client.auth.signInWithPassword({ email: user.email, password: user.password })
    if (signIn.error) return { label, expected, passed: false, reason: safeError(signIn.error) }
  }
  const signed = await client.storage.from(fixture.bucket).createSignedUrl(fixture.path, 30)
  const signedUrlCreated = !signed.error && Boolean(signed.data?.signedUrl)
  let httpStatus = null
  if (signedUrlCreated) httpStatus = (await fetch(signed.data.signedUrl)).status
  const folder = dirname(fixture.path).replaceAll('\\', '/')
  const filename = fixture.path.slice(fixture.path.lastIndexOf('/') + 1)
  const listed = await client.storage.from(fixture.bucket).list(folder === '.' ? '' : folder, { search: filename, limit: 10 })
  const visibleInList = !listed.error && Boolean(listed.data?.some((item) => item.name === filename))
  if (user) await client.auth.signOut()
  const actualAuthorized = signedUrlCreated && httpStatus === 200 && visibleInList
  const actualDenied = !signedUrlCreated && !visibleInList
  return {
    label,
    expected,
    signedUrlCreated,
    httpStatus,
    visibleInList,
    error: signed.error?.message || listed.error?.message || null,
    passed: expected ? actualAuthorized : actualDenied,
  }
}

async function testarExpiracao(env, user, fixture) {
  const client = criarCliente(env)
  const signIn = await client.auth.signInWithPassword({ email: user.email, password: user.password })
  if (signIn.error) return { passed: false, reason: safeError(signIn.error) }
  const signed = await client.storage.from(fixture.bucket).createSignedUrl(fixture.path, 3)
  if (signed.error || !signed.data?.signedUrl) return { passed: false, reason: signed.error?.message || 'URL ausente' }
  const immediateStatus = (await fetch(signed.data.signedUrl)).status
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_100))
  const expiredStatus = (await fetch(signed.data.signedUrl)).status
  const renewed = await client.storage.from(fixture.bucket).createSignedUrl(fixture.path, 30)
  const renewedStatus = renewed.data?.signedUrl
    ? (await fetch(renewed.data.signedUrl)).status
    : null
  await client.auth.signOut()
  return {
    immediateStatus,
    expiredStatus,
    renewedStatus,
    passed: immediateStatus === 200 && expiredStatus !== 200 && renewedStatus === 200,
  }
}

function criarCliente(env) {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  return createClient(env.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function linhas(query, label) {
  const { data, error } = await query
  if (error) throw new Error(`Falha ao carregar ${label}: ${error.message}`)
  return data || []
}

async function linha(query, label) {
  const result = await optional(query)
  if (!result) throw new Error(`${label} nao encontrado.`)
  return result
}

async function optional(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data || null
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>')
}
