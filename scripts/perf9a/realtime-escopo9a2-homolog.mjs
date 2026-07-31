#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { assertHomologEnvironment, createAdminClient, getPerf9aLocalDir, loadEnvFile, writeRestrictedJson } from './common.mjs'

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main()
  } catch (error) {
    console.error(`Realtime Escopo 9A.2 falhou: ${safeError(error)}`)
    process.exitCode = 1
  }
}

async function main() {
  loadEnvFile('.env.homolog')
  const env = assertHomologEnvironment()
  const admin = createAdminClient(env)
  const credentialsPath = resolve(getPerf9aLocalDir('credentials'), `users-${env.projectRef}.json`)
  const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'))
  const userA = credentials.users.find((user) => user.key === 'gestor_a')
  const userB = credentials.users.find((user) => user.key === 'gestor_b')
  if (!userA || !userB) throw new Error('Credenciais PERF9A gestor_a/gestor_b ausentes.')

  const clientA = createClient(env.supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const clientB = createClient(env.supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const signInA = await clientA.auth.signInWithPassword({ email: userA.email, password: userA.password })
  const signInB = await clientB.auth.signInWithPassword({ email: userB.email, password: userB.password })
  if (signInA.error || signInB.error) throw new Error(`Login realtime falhou: ${signInA.error?.message || signInB.error?.message || 'erro desconhecido'}`)
  const userAId = signInA.data.user?.id
  const userBId = signInB.data.user?.id
  if (!userAId || !userBId) throw new Error('Usuarios realtime sem id.')

  const events = { a: [], b: [], channels: { a: null, b: null }, errors: [] }
  const uniqueKey = `perf9a-9a2-realtime-${Date.now()}`
  const channelA = clientA.channel(`perf9a-a-${Date.now()}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notificacoes', filter: `usuario_id=eq.${userAId}` }, (payload) => events.a.push({ type: payload.eventType, id: payload.new?.id || payload.old?.id || null, at: new Date().toISOString() }))
  const channelB = clientB.channel(`perf9a-b-${Date.now()}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notificacoes', filter: `usuario_id=eq.${userBId}` }, (payload) => events.b.push({ type: payload.eventType, id: payload.new?.id || payload.old?.id || null, at: new Date().toISOString() }))
  events.channels.a = await subscribe(channelA)
  events.channels.b = await subscribe(channelB)

  let notificationId = null
  try {
    const insertedAt = Date.now()
    const { data, error } = await admin.from('notificacoes').insert({
      usuario_id: userAId,
      titulo: 'PERF9A Realtime',
      mensagem: 'Evento temporario de homologacao.',
      tipo: 'info',
      dedupe_key: uniqueKey,
      lida: false,
    }).select('id').single()
    if (error) throw new Error(`Insercao realtime falhou: ${error.message}`)
    notificationId = data.id
    await wait(3000)
    events.insertLatencyMs = events.a.find((event) => event.id === notificationId)?.at ? Date.now() - insertedAt : null

    const { error: updateError } = await admin.from('notificacoes').update({ lida: true }).eq('id', notificationId)
    if (updateError) throw new Error(`Update realtime falhou: ${updateError.message}`)
    await wait(2000)
    events.updateReceived = events.a.some((event) => event.id === notificationId && event.type === 'UPDATE')
  } finally {
    if (notificationId) {
      const { error } = await admin.from('notificacoes').delete().eq('id', notificationId)
      if (error) events.errors.push(`cleanup: ${error.message}`)
    }
    await clientA.removeChannel(channelA)
    await clientB.removeChannel(channelB)
    await clientA.auth.signOut()
    await clientB.auth.signOut()
  }

  const result = {
    scope: '9A.2',
    gate: 'realtime-two-sessions',
    projectRef: env.projectRef,
    executedAt: new Date().toISOString(),
    isolation: {
      userAReceived: events.a.some((event) => event.id === notificationId),
      userBReceived: events.b.some((event) => event.id === notificationId),
      backendIsolationPassed: events.a.some((event) => event.id === notificationId) && !events.b.some((event) => event.id === notificationId),
    },
    events,
    note: 'Teste direto via Supabase JS; a validação de CSP e renderização web é registrada separadamente pelo smoke autenticado.',
  }
  const evidencePath = resolve(getPerf9aLocalDir('evidence'), `realtime-escopo9a2-${env.projectRef}-${new Date().toISOString().replaceAll(':', '-')}.json`)
  writeRestrictedJson(evidencePath, result)
  console.log(`Realtime direto concluido. Evidencia local restrita: ${evidencePath}`)
  console.log(`Isolamento backend: ${result.isolation.backendIsolationPassed ? 'PASSOU' : 'FALHOU'}`)
}

function subscribe(channel) {
  return new Promise((resolvePromise) => {
    const timeout = setTimeout(() => resolvePromise('TIMEOUT'), 10_000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timeout)
        resolvePromise(status)
      }
    })
  })
}

function wait(ms) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)) }
function safeError(error) { return error instanceof Error ? error.message.replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>') : String(error) }
