#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const args = parseArgs(process.argv.slice(2))

try {
  main()
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

function main() {
  loadEnvFile(args['env-file'])

  if (args.help || args.h) {
    console.log(helpText())
    return
  }

  const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260723182639_reset_operacional_fundo_homolog_rpc.sql')
  if (!existsSync(migrationPath)) {
    throw new Error(`Migration da RPC nao encontrada: ${migrationPath}`)
  }

  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || buildDbUrlFromSupabaseEnv()

  if (!dbUrl) {
    throw new Error([
      'Nao foi possivel montar a URL direta do banco.',
      'Configure SUPABASE_DB_URL ou DATABASE_URL no .env.homolog.',
      'Recomendado: copie do Supabase Dashboard a connection string do Session pooler ou Direct connection.',
    ].join('\n'))
  }

  console.log('\nAplicando RPC reset_operacional_fundo_homolog no banco configurado...')
  console.log('Arquivo:', migrationPath)
  console.log('Destino:', maskDbUrl(dbUrl))

  const result = process.platform === 'win32'
    ? runSupabaseCliOnWindows(dbUrl, migrationPath)
    : spawnSync('npx', [
      'supabase',
      'db',
      'query',
      '--db-url',
      dbUrl,
      '--file',
      migrationPath,
      '--output',
      'table',
      '--yes',
    ], {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: false,
    })

  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Falha ao aplicar RPC. Exit code: ${result.status}`)

  console.log('\nRPC aplicada. Se o preview ainda retornar PGRST202, aguarde alguns segundos para o schema cache atualizar e rode novamente.')
}

function runSupabaseCliOnWindows(dbUrl, migrationPath) {
  const tempDirSuffix = Date.now()
  const tempPsPath = resolve(tmpdir(), `bw-antecipa-install-rpc-${Date.now()}.ps1`)
  const sqlFiles = createSingleStatementSqlFiles(migrationPath, tempDirSuffix)

  const commandLines = sqlFiles.map((file) => (
    `npx supabase db query --db-url $env:BW_RESET_DB_URL --file ${quotePowerShell(file)} --output table --yes`
  ))

  const psScript = [
    '$ErrorActionPreference = "Stop"',
    '$env:BW_RESET_DB_URL = @\'',
    dbUrl,
    '\'@',
    ...commandLines,
    'exit $LASTEXITCODE',
  ].join('\r\n')

  writeFileSync(tempPsPath, psScript, 'utf8')

  return spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    tempPsPath,
  ], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
  })
}

function createSingleStatementSqlFiles(migrationPath, suffix) {
  const sql = readFileSync(migrationPath, 'utf8')
  const functionMatch = sql.match(/CREATE OR REPLACE FUNCTION[\s\S]+?\n\$\$;/)
  if (!functionMatch) {
    throw new Error('Nao foi possivel extrair CREATE OR REPLACE FUNCTION da migration.')
  }

  const statements = [
    functionMatch[0],
    'REVOKE ALL ON FUNCTION public.reset_operacional_fundo_homolog(uuid, text, boolean, text) FROM PUBLIC;',
    'GRANT EXECUTE ON FUNCTION public.reset_operacional_fundo_homolog(uuid, text, boolean, text) TO service_role;',
  ]

  return statements.map((statement, index) => {
    const file = resolve(tmpdir(), `bw-antecipa-reset-rpc-${suffix}-${index + 1}.sql`)
    writeFileSync(file, statement, 'utf8')
    return file
  })
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function buildDbUrlFromSupabaseEnv() {
  if (process.env.SUPABASE_ALLOW_DIRECT_DB_URL !== 'true') return null

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const password = process.env.SUPABASE_PASSWORD
  const user = process.env.SUPABASE_DB_USER || 'postgres'
  const database = process.env.SUPABASE_DB_NAME || 'postgres'
  const port = process.env.SUPABASE_DB_PORT || '5432'

  if (!supabaseUrl || !password) return null

  const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
  if (!projectRef) return null

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:${port}/${encodeURIComponent(database)}`
}

function maskDbUrl(dbUrl) {
  try {
    const url = new URL(dbUrl)
    if (url.password) url.password = '***'
    return url.toString()
  } catch {
    return '<db-url>'
  }
}

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (!arg.startsWith('--')) continue

    const raw = arg.slice(2)
    const [key, inlineValue] = raw.split('=', 2)
    const next = argv[index + 1]

    if (inlineValue !== undefined) {
      parsed[key] = inlineValue
      continue
    }

    if (next && !next.startsWith('--')) {
      parsed[key] = next
      index += 1
      continue
    }

    parsed[key] = true
  }

  return parsed
}

function loadEnvFile(envFileArg) {
  const candidates = [
    envFileArg,
    '.env.homolog',
    '.env.local',
    '.env',
  ].filter(Boolean)

  for (const file of candidates) {
    const path = resolve(process.cwd(), file)
    if (!existsSync(path)) continue

    const content = readFileSync(path, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!match) continue

      const [, key, rawValue] = match
      if (process.env[key] !== undefined) continue

      process.env[key] = normalizeEnvValue(rawValue)
    }
  }
}

function normalizeEnvValue(rawValue) {
  const value = rawValue.trim()
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function helpText() {
  return [
    'Uso:',
    '  npm run reset:operacional:fundo:install-rpc',
    '',
    'Opcoes:',
    '  --env-file <arquivo>  carrega um .env especifico antes de .env.homolog/.env.local/.env',
    '',
    'Variaveis aceitas:',
    '  SUPABASE_DB_URL ou DATABASE_URL',
    '',
    'Recomendado para Windows/redes IPv4-only:',
    '  SUPABASE_DB_URL=postgresql://postgres.<project-ref>:<senha>@aws-<region>.pooler.supabase.com:5432/postgres',
    '',
    'Fallback opcional, menos recomendado:',
    '  SUPABASE_ALLOW_DIRECT_DB_URL=true para montar db.<project-ref>.supabase.co com NEXT_PUBLIC_SUPABASE_URL + SUPABASE_PASSWORD',
  ].join('\n')
}
