#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { parseArgs } from '../perf9a/common.mjs'

const args = parseArgs()

try {
  await main()
} catch (error) {
  console.error(`\nBootstrap de Super Admin falhou: ${safeErrorMessage(error)}\n`)
  process.exitCode = 1
}

async function main() {
  if (args.help === true) {
    printHelp()
    return
  }

  const env = loadStrictHomologEnv()
  assertHomologEnvironment(env)
  assertExpectedProjectRef(args['expected-project-ref'], env.projectRef)

  const email = normalizeEmail(args.email)
  const execute = args.execute === true
  const confirmation = buildConfirmation(env.projectRef)
  if (execute) assertExecuteConfirmation(args.confirm, confirmation)

  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })

  console.log(`\nBW Antecipa - BOOTSTRAP SUPER ADMIN (${execute ? 'EXECUCAO' : 'PREVIEW'})`)
  console.log(`Ambiente: ${env.appEnv}`)
  console.log(`Projeto Supabase: ${env.projectRef}`)
  console.log(`Usuario: ${maskEmail(email)}`)
  console.log('Senha: nao solicitada; o acesso inicial usa convite seguro do Supabase Auth')

  const existingUser = await findAuthUserByEmail(admin, email)
  const existingProfile = existingUser ? await loadProfile(admin, existingUser.id) : null
  validateExistingIdentity(existingProfile)

  if (!execute) {
    console.log(`Auth user: ${existingUser ? 'existente' : 'sera convidado'}`)
    console.log(`Perfil: ${existingProfile ? `existente (${existingProfile.role})` : 'sera criado pelo fluxo administrativo'}`)
    console.log('Papel complementar super_admin: sera garantido de forma idempotente')
    console.log('\nPREVIEW concluido. Nenhum dado foi alterado e nenhum convite foi enviado.')
    console.log(buildExecuteCommand(env.projectRef, email, confirmation))
    return
  }

  const user = existingUser || await inviteSuperAdmin(admin, email, String(args.name || '').trim())
  const profile = existingProfile || await ensureProfile(admin, user, String(args.name || '').trim(), {
    promoteInvitedUser: !existingUser,
  })

  const { error: provisionError } = await admin.rpc('provisionar_super_admin_homolog', {
    p_usuario_id: user.id,
    p_project_ref: env.projectRef,
  })
  if (provisionError) throw new Error(`Nao foi possivel concluir papel e auditoria administrativos: ${provisionError.message}`)

  console.log('\nBootstrap concluido.')
  console.log(`Perfil primario preservado: ${profile.role}`)
  console.log('Papel complementar ativo: super_admin')
  console.log(existingUser ? 'Usuario existente atualizado sem alterar senha.' : 'Convite de acesso solicitado pelo Supabase Auth.')
}

function loadStrictHomologEnv() {
  const path = resolve(process.cwd(), '.env.homolog')
  if (!existsSync(path)) throw new Error('Arquivo .env.homolog nao encontrado.')

  const values = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    values[match[1]] = normalizeEnvValue(match[2])
  }

  const supabaseUrl = values.SUPABASE_URL || values.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = values.SUPABASE_SERVICE_ROLE_KEY
  const productionProjectRef = values.SUPABASE_PRODUCTION_PROJECT_REF || values.PRODUCTION_SUPABASE_PROJECT_REF
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem existir em .env.homolog.')
  }
  if (!productionProjectRef) {
    throw new Error('SUPABASE_PRODUCTION_PROJECT_REF deve identificar explicitamente o projeto de producao em .env.homolog.')
  }

  const url = new URL(supabaseUrl)
  const projectRef = url.hostname.split('.')[0]
  return {
    appEnv: String(values.NEXT_PUBLIC_APP_ENV || '').toLowerCase(),
    supabaseUrl,
    serviceRoleKey,
    projectRef,
    productionProjectRef,
  }
}

function assertHomologEnvironment(env) {
  if (process.env.NODE_ENV === 'production') throw new Error('Bootstrap bloqueado com NODE_ENV=production.')
  if (!['homolog', 'homologacao'].includes(env.appEnv)) {
    throw new Error('Bootstrap permitido somente quando NEXT_PUBLIC_APP_ENV identifica homologacao.')
  }
  if (!env.projectRef || !env.supabaseUrl.endsWith('.supabase.co')) throw new Error('Projeto Supabase de homologacao invalido.')
  if (env.productionProjectRef === env.projectRef) {
    throw new Error('Bootstrap bloqueado: o project ref corresponde ao ambiente de producao declarado.')
  }
}

function assertExpectedProjectRef(expected, actual) {
  if (!expected || expected !== actual) {
    throw new Error(`Projeto nao confirmado. Informe exatamente --expected-project-ref ${actual}.`)
  }
}

function assertExecuteConfirmation(value, expected) {
  if (value !== expected) throw new Error(`Confirmacao invalida. Informe exatamente --confirm ${expected}.`)
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail valido em --email.')
  return email
}

async function findAuthUserByEmail(admin, email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`Nao foi possivel consultar usuarios Auth: ${error.message}`)
    const found = data.users.find((user) => user.email?.toLowerCase() === email)
    if (found) return found
    if (data.users.length < 1000) return null
  }
}

async function loadProfile(admin, userId) {
  const { data, error } = await admin.from('profiles').select('id, role, status, nome_completo, email').eq('id', userId).maybeSingle()
  if (error) throw new Error(`Nao foi possivel consultar o perfil: ${error.message}`)
  return data
}

function validateExistingIdentity(profile) {
  if (!profile) return
  if (!['gestor', 'super_admin'].includes(profile.role)) {
    throw new Error('O e-mail informado pertence a um perfil operacional incompatível com o bootstrap (somente gestor ou super_admin).')
  }
  if (profile.status !== 'ativo') throw new Error('O perfil existente nao esta ativo. Regularize-o antes do bootstrap.')
}

async function inviteSuperAdmin(admin, email, name) {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { nome_completo: name || 'Super Admin' },
  })
  if (error || !data.user) throw new Error(`Nao foi possivel enviar o convite administrativo: ${error?.message || 'retorno vazio'}`)
  return data.user
}

async function ensureProfile(admin, user, name, { promoteInvitedUser = false } = {}) {
  const profile = await loadProfile(admin, user.id)
  if (profile && !promoteInvitedUser) return profile

  if (profile) {
    const { data, error } = await admin.from('profiles').update({
      role: 'super_admin',
      nome_completo: name || profile.nome_completo || 'Super Admin',
    }).eq('id', user.id).select('id, role, status, nome_completo, email').single()
    if (error || !data) throw new Error(`Nao foi possivel preparar o perfil administrativo: ${error?.message || 'retorno vazio'}`)
    return data
  }

  const { data, error } = await admin.from('profiles').insert({
    id: user.id,
    role: 'super_admin',
    nome_completo: name || 'Super Admin',
    email: user.email,
    status: 'ativo',
  }).select('id, role, status, nome_completo, email').single()
  if (error || !data) throw new Error(`Nao foi possivel criar o perfil administrativo: ${error?.message || 'retorno vazio'}`)
  return data
}

function normalizeEnvValue(value) {
  const trimmed = String(value).trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1)
  return trimmed
}

function buildConfirmation(projectRef) {
  return `PROVISIONAR_SUPER_ADMIN_HOMOLOG_${projectRef}`
}

function buildExecuteCommand(projectRef, email, confirmation) {
  return `npm run bootstrap:super-admin:homolog -- --email ${email} --execute --expected-project-ref ${projectRef} --confirm ${confirmation}`
}

function maskEmail(email) {
  const [local, domain] = email.split('@')
  return `${local.slice(0, 2)}***@${domain}`
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function printHelp() {
  console.log(`
Bootstrap seguro do primeiro Super Admin em homologacao.

Preview (padrao):
  npm run bootstrap:super-admin:homolog -- --email admin@empresa.com --expected-project-ref <project-ref>

Execucao:
  npm run bootstrap:super-admin:homolog -- --email admin@empresa.com --execute --expected-project-ref <project-ref> --confirm PROVISIONAR_SUPER_ADMIN_HOMOLOG_<project-ref>

Opcoes:
  --email <email>               Usuario a provisionar ou promover
  --name <nome>                 Nome usado apenas quando o usuario for novo
  --expected-project-ref <ref>  Confirma explicitamente o projeto Supabase
  --execute                     Envia convite e persiste o papel
  --confirm <frase>             Confirmacao vinculada ao project ref
  --help                        Exibe esta ajuda

O script le exclusivamente .env.homolog e nunca recebe senha por argumento.
`)
}
