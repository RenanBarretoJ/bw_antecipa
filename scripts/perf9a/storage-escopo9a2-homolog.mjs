#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { assertHomologEnvironment, createAdminClient, getPerf9aLocalDir, loadEnvFile, writeRestrictedJson } from './common.mjs'

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { await main() } catch (error) { console.error(`Storage Escopo 9A.2 falhou: ${safeError(error)}`); process.exitCode = 1 }
}

async function main() {
  loadEnvFile('.env.homolog')
  const env = assertHomologEnvironment()
  const admin = createAdminClient(env)
  const credentials = JSON.parse(readFileSync(resolve(getPerf9aLocalDir('credentials'), `users-${env.projectRef}.json`), 'utf8'))
  const users = new Map(credentials.users.map((user) => [user.key, user]))
  const fixture = await findFixture(admin)
  const probePath = `perf9a/documentos/${fixture.documentoId}/escopo9a2-${Date.now()}.txt`
  const upload = await admin.storage.from(fixture.bucket).upload(probePath, new TextEncoder().encode('BW Antecipa PERF9A storage probe'), { contentType: 'text/plain', upsert: false })
  if (upload.error) throw new Error(`Nao foi possivel criar objeto temporario de Storage: ${upload.error.message}`)
  let authorized
  let adversary
  try {
    authorized = await testUserStorage(env, users.get('gestor_a'), { ...fixture, path: probePath }, true)
    adversary = await testUserStorage(env, users.get('gestor_b'), { ...fixture, path: probePath }, false)
  } finally {
    await admin.storage.from(fixture.bucket).remove([probePath])
  }
  const result = { scope: '9A.2', gate: 'storage-signed-urls', projectRef: env.projectRef, executedAt: new Date().toISOString(), fixture: { bucket: fixture.bucket, fund: 'PERF9A_FUNDO_A', probePathRedacted: 'perf9a/documentos/<documento>/escopo9a2-<timestamp>.txt' }, authorized, adversary, status: authorized.signedUrlCreated && authorized.downloadStatus === 200 && !adversary.signedUrlCreated ? 'APROVADO' : 'NO-GO' }
  const evidencePath = resolve(getPerf9aLocalDir('evidence'), `storage-escopo9a2-${env.projectRef}-${new Date().toISOString().replaceAll(':', '-')}.json`)
  writeRestrictedJson(evidencePath, result)
  console.log(`Storage concluido. Evidencia local restrita: ${evidencePath}`)
  console.log(`Autorizado: ${authorized.signedUrlCreated ? 'URL criada' : 'bloqueado'} / download ${authorized.downloadStatus ?? '-'}; adversario: ${adversary.signedUrlCreated ? 'URL criada' : 'URL negada'}`)
}

async function findFixture(admin) {
  const versions = await select(admin.from('documento_versoes').select('documento_id,bucket,path').like('path', 'perf9a/%').limit(100), 'versoes PERF9A')
  for (const version of versions) {
    const { data: requirement } = await admin.from('documento_requisito_instancias').select('nota_fiscal_id').eq('documento_id', version.documento_id).limit(1).maybeSingle()
    if (!requirement?.nota_fiscal_id) continue
    const { data: nf } = await admin.from('notas_fiscais').select('fundo_id').eq('id', requirement.nota_fiscal_id).maybeSingle()
    if (nf?.fundo_id) return { ...version, documentoId: version.documento_id, fundId: nf.fundo_id }
  }
  throw new Error('Nenhum arquivo documental PERF9A vinculado a NF foi encontrado.')
}

async function testUserStorage(env, user, fixture, expectedAuthorized) {
  if (!user) throw new Error('Credencial PERF9A ausente.')
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const client = createClient(env.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const signIn = await client.auth.signInWithPassword({ email: user.email, password: user.password })
  if (signIn.error) return { signIn: false, error: safeError(signIn.error) }
  const signed = await client.storage.from(fixture.bucket).createSignedUrl(fixture.path, 60)
  const signedUrlCreated = !signed.error && Boolean(signed.data?.signedUrl)
  let downloadStatus = null
  if (signedUrlCreated) {
    const response = await fetch(signed.data.signedUrl)
    downloadStatus = response.status
  }
  const listed = await client.storage.from(fixture.bucket).list('perf9a', { limit: 5 })
  await client.auth.signOut()
  return { signIn: true, expectedAuthorized, signedUrlCreated, signedUrlError: signed.error?.message || null, downloadStatus, listDenied: Boolean(listed.error), listError: listed.error?.message || null }
}

async function select(query, label) { const { data, error } = await query; if (error) throw new Error(`Falha ao carregar ${label}: ${error.message}`); return data || [] }
function safeError(error) { return (error instanceof Error ? error.message : String(error)).replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>') }
