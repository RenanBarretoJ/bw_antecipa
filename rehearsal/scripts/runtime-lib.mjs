import crypto from 'node:crypto'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import {
  LOCAL_DB,
  PRODUCTION_PROJECT_REF,
  HOMOLOG_PROJECT_REF,
  REPOSITORY_ROOT,
  assertLocalTarget,
  runSupabase,
  sha256,
  stableJson,
} from './lib.mjs'

const EXTERNAL_ENV_PATTERN = /(SMTP|RESEND|FROMTIS|SINQIA|VORTX|TRANSPORTADORA|SIMFRETE|WEBHOOK|CRON_SECRET|ESCROW|PORTAL_FIDC|CERTIFICATE|PRIVATE_KEY)/iu

export function localSupabaseStatus() {
  assertLocalTarget()
  const status = JSON.parse(runSupabase(['status', '--output', 'json']).stdout)
  const api = new URL(status.API_URL)
  const database = new URL(status.DB_URL)
  if (api.hostname !== '127.0.0.1' || Number(api.port) !== 55321) throw new Error('API Supabase fora do rehearsal local.')
  if (database.hostname !== '127.0.0.1' || Number(database.port) !== LOCAL_DB.port) throw new Error('Postgres fora do rehearsal local.')
  return status
}

export function safeRuntimeEnvironment(status = localSupabaseStatus()) {
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    const value = String(env[name] ?? '')
    if (EXTERNAL_ENV_PATTERN.test(name) || value.includes(PRODUCTION_PROJECT_REF) || value.includes(HOMOLOG_PROJECT_REF)) delete env[name]
  }
  return {
    ...env,
    NODE_ENV: 'development',
    NEXT_PUBLIC_APP_ENV: 'rehearsal/local',
    INTEGRATION_RUNTIME_ENV: 'homologacao',
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    APP_BASE_URL: 'http://localhost:3001',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3001',
    // Sink SMTP estritamente local. Nenhuma mensagem do rehearsal pode sair
    // para o provedor operacional configurado nos ambientes remotos.
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '55325',
    SMTP_SECURE: 'false',
    SMTP_ALLOW_INSECURE_LOCAL: 'true',
    SMTP_USER: 'rehearsal@bw-antecipa.invalid',
    SMTP_PASSWORD: 'rehearsal-local-only', // dummy exclusivo do SMTP local
    EMAIL_FROM: 'BETTER WITH <rehearsal@bw-antecipa.invalid>',
  }
}

export function localAdminClient(status = localSupabaseStatus()) {
  return createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function spawnRuntime() {
  const child = spawn(process.execPath, [path.join(REPOSITORY_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--hostname', '127.0.0.1', '--port', '3001'], {
    cwd: REPOSITORY_ROOT,
    env: safeRuntimeEnvironment(),
    stdio: 'inherit',
    windowsHide: true,
  })
  return child
}

export function snapshotHash(snapshot) {
  return sha256(stableJson(snapshot))
}

export function randomRehearsalPassword() {
  return `R!${crypto.randomBytes(24).toString('base64url')}9a`
}

export function totp(secret, now = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const normalized = secret.toUpperCase().replace(/[^A-Z2-7]/gu, '')
  let bits = ''
  for (const char of normalized) bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  const bytes = []
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const digest = crypto.createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(value).padStart(6, '0')
}
