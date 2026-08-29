#!/usr/bin/env node
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  assertHomologEnvironment,
  createAdminClient,
  getPerf9aLocalDir,
  listAllAuthUsers,
  loadEnvFile,
  writeRestrictedJson,
} from '../../../perf9a/common.mjs'
import { generatePassword, generateTotp } from '../../../perf9a/dataset.mjs'

const PREFIX = 'P2610_'
const DOMAIN = 'p2-6-10.qa.invalid'
const DEFINITIONS = [
  { key: 'gestor_a', role: 'gestor', name: 'P2610 Gestor QA A' },
  { key: 'gestor_b', role: 'gestor', name: 'P2610 Gestor QA B' },
  { key: 'super_admin_puro', role: 'gestor', name: 'P2610 Super Admin QA Puro' },
  { key: 'super_admin_gestor_a', role: 'gestor', name: 'P2610 Super Admin Gestor QA A' },
]

loadEnvFile('.env.homolog')
const env = assertHomologEnvironment()
if (env.projectRef !== 'fhgkmggthxikfpogrvaa') {
  throw new Error(`Projeto bloqueado: esperado fhgkmggthxikfpogrvaa, recebido ${env.projectRef}.`)
}

const admin = createAdminClient(env)
const action = process.argv.includes('--cleanup') ? 'cleanup' : 'create'
const localPath = resolve(getPerf9aLocalDir('p2-6-10'), `actors-${env.projectRef}.json`)

if (action === 'cleanup') {
  const users = await listAllAuthUsers(admin)
  const qaUsers = users.filter((user) => user.email?.endsWith(`@${DOMAIN}`))
  for (const user of qaUsers) {
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) throw new Error(`Falha ao remover ator QA ${user.id}: ${error.message}`)
  }
  rmSync(localPath, { force: true })
  console.log(JSON.stringify({ status: 'PASS', project_ref: env.projectRef, removed_users: qaUsers.length }))
  process.exit(0)
}

const existing = (await listAllAuthUsers(admin)).filter((user) => user.email?.endsWith(`@${DOMAIN}`))
if (existing.length > 0) {
  throw new Error('Atores P2.6.10 ja existem. Execute este script com --cleanup antes de recriar.')
}

const created = []
try {
  for (const definition of DEFINITIONS) {
    const email = `${definition.key}@${DOMAIN}`
    const password = generatePassword()
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome_completo: definition.name, role: definition.role, p2610: true },
    })
    if (error || !data.user) throw new Error(error?.message || 'Auth retornou usuario vazio.')

    const totpSecret = await enrollTotp(env, email, password, `${PREFIX}${definition.key}`)
    created.push({ ...definition, id: data.user.id, email, password, totpSecret })
  }
} catch (error) {
  for (const actor of created.reverse()) await admin.auth.admin.deleteUser(actor.id).catch(() => undefined)
  throw error
}

writeRestrictedJson(localPath, {
  projectRef: env.projectRef,
  createdAt: new Date().toISOString(),
  actors: created,
})
console.log(JSON.stringify({
  status: 'PASS',
  project_ref: env.projectRef,
  actors_created: created.map(({ key, id, role }) => ({ key, id, role })),
  credential_file_outside_repository: true,
}))

async function enrollTotp(currentEnv, email, password, friendlyName) {
  const client = createClient(currentEnv.supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  const { data: enrollment, error: enrollError } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  })
  if (enrollError || !enrollment?.id || !enrollment.totp?.secret) throw enrollError || new Error('MFA incompleto.')
  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: enrollment.id })
  if (challengeError || !challenge?.id) throw challengeError || new Error('Challenge MFA incompleto.')
  const { error: verifyError } = await client.auth.mfa.verify({
    factorId: enrollment.id,
    challengeId: challenge.id,
    code: generateTotp(enrollment.totp.secret),
  })
  if (verifyError) throw verifyError
  await client.auth.signOut()
  return enrollment.totp.secret
}
