import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const EXPECTED_APP_URL = 'https://bw-antecipa.better-with.tech'

function parseUrl(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function inspectProductionValues(env) {
  const appUrl = parseUrl(env.APP_BASE_URL)
  const fromtisUrl = parseUrl(env.FROMTIS_URL)
  const smtpHost = String(env.SMTP_HOST || '').toLowerCase()
  const smtpPort = String(env.SMTP_PORT || '')
  const smtpSecure = String(env.SMTP_SECURE || '').toLowerCase()
  const emailFrom = String(env.EMAIL_FROM || '')
  const email = emailFrom.match(/<([^>]+)>/u)?.[1] || emailFrom

  return {
    NEXT_PUBLIC_APP_ENV: {
      present: Boolean(env.NEXT_PUBLIC_APP_ENV),
      valid: env.NEXT_PUBLIC_APP_ENV === 'production',
    },
    INTEGRATION_RUNTIME_ENV: {
      present: Boolean(env.INTEGRATION_RUNTIME_ENV),
      valid: env.INTEGRATION_RUNTIME_ENV === 'production',
    },
    APP_BASE_URL: {
      observable: Boolean(env.APP_BASE_URL),
      exact: env.APP_BASE_URL === EXPECTED_APP_URL,
      https: appUrl?.protocol === 'https:',
      nonProductionReference: /localhost|127\.0\.0\.1|homolog/iu.test(env.APP_BASE_URL || ''),
    },
    SINQIA_TERRA: {
      urlPresent: Boolean(env.FROMTIS_URL),
      urlHttps: fromtisUrl?.protocol === 'https:',
      urlNonProductionReference: /localhost|127\.0\.0\.1|homolog/iu.test(env.FROMTIS_URL || ''),
      usernameObservable: Boolean(env.FROMTIS_USERNAME),
      passwordObservable: Boolean(env.FROMTIS_PASSWORD),
      tipoPresent: Boolean(env.FROMTIS_TIPO_RECEBIVEL),
      tipoValid: !env.FROMTIS_TIPO_RECEBIVEL || /^\d{2}$/u.test(env.FROMTIS_TIPO_RECEBIVEL),
    },
    SMTP: {
      hostPresent: Boolean(env.SMTP_HOST),
      hostNonLocal: Boolean(smtpHost) && !/localhost|127\.0\.0\.1/u.test(smtpHost),
      ionos: /ionos/u.test(smtpHost),
      portProfile: smtpPort === '465' ? '465' : smtpPort === '587' ? '587' : 'other',
      secureValid:
        (smtpPort === '465' && ['true', '1'].includes(smtpSecure))
        || (smtpPort === '587' && ['false', '0'].includes(smtpSecure)),
      userObservable: Boolean(env.SMTP_USER),
      passwordObservable: Boolean(env.SMTP_PASSWORD),
      fromPresent: Boolean(emailFrom),
      fromHasDomain: Boolean(email.split('@')[1]),
      insecureLocalGuard: Boolean(env.SMTP_ALLOW_INSECURE_LOCAL),
    },
  }
}

export function sanitizeMetadata(payload) {
  return (payload.envs || []).map((entry) => ({
    key: entry.key,
    type: entry.type,
    target: entry.target,
    present: true,
  })).sort((left, right) => left.key.localeCompare(right.key))
}

function loadMetadata() {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'vercel'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'vercel env list production --project bw-antecipa --scope renanbarretoj --json']
    : ['env', 'list', 'production', '--project', 'bw-antecipa', '--scope', 'renanbarretoj', '--json']
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false })

  if (result.status !== 0) throw new Error('Falha ao consultar metadata da Vercel Production.')
  const start = result.stdout.indexOf('{')
  if (start < 0) throw new Error('Resposta JSON da Vercel nao encontrada.')
  return sanitizeMetadata(JSON.parse(result.stdout.slice(start)))
}

function main() {
  const mode = process.argv[2]
  if (mode === '--values') {
    console.log(JSON.stringify(inspectProductionValues(process.env), null, 2))
    return
  }
  if (mode === '--metadata') {
    console.log(JSON.stringify(loadMetadata(), null, 2))
    return
  }
  throw new Error('Use --values ou --metadata.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
