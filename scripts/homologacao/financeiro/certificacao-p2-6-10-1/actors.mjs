#!/usr/bin/env node

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
import { resolve } from 'node:path'

const PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const RETAINED_DOMAIN = 'p2-6-10.qa.invalid'
const NEW_DOMAIN = 'p2-6-10-1.qa.invalid'
const RETAINED = [
  { key: 'gestor_a', email: `gestor_a@${RETAINED_DOMAIN}`, role: 'gestor' },
  { key: 'gestor_b', email: `gestor_b@${RETAINED_DOMAIN}`, role: 'gestor' },
]

loadEnvFile('.env.homolog')
const env = assertHomologEnvironment()
if (env.projectRef !== PROJECT_REF) throw new Error(`Projeto bloqueado: ${env.projectRef}`)

const admin = createAdminClient(env)
const users = await listAllAuthUsers(admin)
const actors = []

for (const definition of RETAINED) {
  const user = users.find((candidate) => candidate.email === definition.email)
  if (!user) throw new Error(`Ator retido obrigatorio ausente: ${definition.key}`)
  actors.push(await prepareActor({ ...definition, id: user.id }, true))
}

const pureEmail = `super_admin_puro@${NEW_DOMAIN}`
let pureUser = users.find((candidate) => candidate.email === pureEmail)
if (!pureUser) {
  const password = generatePassword()
  const { data, error } = await admin.auth.admin.createUser({
    email: pureEmail,
    password,
    email_confirm: true,
    user_metadata: { nome_completo: 'P2.6.10.1 Super Admin QA Puro', role: 'super_admin', qa_phase: 'P2.6.10.1' },
  })
  if (error || !data.user) throw new Error(error?.message || 'Auth retornou usuario vazio.')
  pureUser = data.user
}

const pure = await prepareActor({ key: 'super_admin_puro', email: pureEmail, role: 'super_admin', id: pureUser.id }, true)
actors.push(pure)

const { error: profileError } = await admin
  .from('profiles')
  .update({ role: 'super_admin', status: 'ativo', nome_completo: 'P2.6.10.1 Super Admin QA Puro' })
  .eq('id', pure.id)
if (profileError) throw new Error(`Falha ao configurar profile QA: ${profileError.message}`)

const { error: roleError } = await admin.from('usuario_papeis').upsert({
  usuario_id: pure.id,
  papel: 'super_admin',
  ativo: true,
  origem: 'bootstrap_homolog',
  revogado_em: null,
}, { onConflict: 'usuario_id,papel' })
if (roleError) throw new Error(`Falha ao configurar papel QA: ${roleError.message}`)

const unlinkedEmail = `gestor_sem_vinculo@${NEW_DOMAIN}`
let unlinkedUser = users.find((candidate) => candidate.email === unlinkedEmail)
if (!unlinkedUser) {
  const password = generatePassword()
  const { data, error } = await admin.auth.admin.createUser({
    email: unlinkedEmail,
    password,
    email_confirm: true,
    user_metadata: { nome_completo: 'P2.6.10.1 Gestor QA sem vinculo', role: 'gestor', qa_phase: 'P2.6.10.1' },
  })
  if (error || !data.user) throw new Error(error?.message || 'Auth retornou gestor sem vinculo vazio.')
  unlinkedUser = data.user
}

const unlinked = await prepareActor({ key: 'gestor_sem_vinculo', email: unlinkedEmail, role: 'gestor', id: unlinkedUser.id }, true)
actors.push(unlinked)
const { error: unlinkedProfileError } = await admin
  .from('profiles')
  .update({ role: 'gestor', status: 'ativo', nome_completo: 'P2.6.10.1 Gestor QA sem vinculo' })
  .eq('id', unlinked.id)
if (unlinkedProfileError) throw new Error(`Falha ao configurar profile sem vinculo: ${unlinkedProfileError.message}`)
const { error: unlinkedRoleError } = await admin.from('usuario_papeis').upsert({
  usuario_id: unlinked.id,
  papel: 'gestor',
  ativo: true,
  origem: 'bootstrap_homolog',
  revogado_em: null,
}, { onConflict: 'usuario_id,papel' })
if (unlinkedRoleError) throw new Error(`Falha ao configurar papel sem vinculo: ${unlinkedRoleError.message}`)

const { error: unlinkError } = await admin.from('usuario_fundos').delete().eq('usuario_id', unlinked.id)
if (unlinkError) throw new Error(`Falha ao garantir gestor sem vinculo: ${unlinkError.message}`)

const localPath = resolve(getPerf9aLocalDir('p2-6-10-1'), `actors-${env.projectRef}.json`)
writeRestrictedJson(localPath, { projectRef: env.projectRef, createdAt: new Date().toISOString(), actors })
console.log(JSON.stringify({
  status: 'PASS',
  project_ref: env.projectRef,
  actors_prepared: actors.map(({ key, id, role }) => ({ key, id, role })),
  credential_file_outside_repository: true,
}))

async function prepareActor(definition, rotateCredentials) {
  const password = generatePassword()
  if (rotateCredentials) {
    const { error } = await admin.auth.admin.updateUserById(definition.id, { password })
    if (error) throw new Error(`Falha ao rotacionar ator ${definition.key}: ${error.message}`)
    await clearFactors(definition.id)
  }
  const totpSecret = await enrollTotp(definition.email, password, `P26101_${definition.key}`)
  return { ...definition, password, totpSecret }
}

async function clearFactors(userId) {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId })
  if (error) throw new Error(`Falha ao listar fatores QA: ${error.message}`)
  for (const factor of data?.factors || []) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id })
    if (deleteError) throw new Error(`Falha ao remover fator QA: ${deleteError.message}`)
  }
}

async function enrollTotp(email, password, friendlyName) {
  const client = createClient(env.supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError
  const { data: enrollment, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName })
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
