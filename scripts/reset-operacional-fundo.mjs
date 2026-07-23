#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const args = parseArgs(process.argv.slice(2))

try {
  await main()
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

async function main() {
  loadEnvFile(args['env-file'])

  if (args.help || args.h) {
    printHelp()
    return
  }

  const fundoId = args['fundo-id'] ?? args.fundo
  const mode = args.mode ?? (args.reset ? 'reset' : args.validate ? 'validate' : 'preview')
  const apagarNotas = parseBoolean(args['apagar-notas'] ?? args['apagar-notas-fiscais'] ?? 'true')
  const deleteStorage = Boolean(args['delete-storage'])
  const yes = Boolean(args.yes)

  if (!fundoId) throw new Error(`Informe o fundo.\n\n${helpText()}`)
  if (!['preview', 'reset', 'validate'].includes(mode)) throw new Error(`Modo invalido: ${mode}. Use preview, reset ou validate.`)
  if (mode === 'reset' && !yes) throw new Error('Reset destrutivo bloqueado. Reexecute com --yes depois de conferir o preview.')

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) throw new Error('SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_URL nao configurada.')
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY nao configurada. Este script exige service role e nao roda no browser.')

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  console.log(`\nBW Antecipa - reset operacional de fundo (${mode})`)
  console.log(`Fundo: ${fundoId}`)
  console.log(`Apagar NFs: ${apagarNotas ? 'sim' : 'nao'}`)
  console.log(`Apagar Storage apos reset: ${deleteStorage ? 'sim' : 'nao'}\n`)

  const { data, error } = await supabase.rpc('reset_operacional_fundo_homolog', {
    p_fundo_id: fundoId,
    p_modo: mode,
    p_apagar_notas_fiscais: apagarNotas,
    p_confirmacao: mode === 'reset' ? 'RESETAR_HOMOLOG' : null,
  })

  if (error) throw new Error(formatSupabaseError(error))

  printResult(data)

  if (mode === 'reset' && deleteStorage) {
    await deleteStorageObjects(supabase, data?.storage_objects ?? [])
  }

  if (mode === 'reset') {
    console.log('\nReset concluido. Recomendo rodar agora:')
    console.log(`  npm run reset:operacional:fundo -- --fundo-id ${fundoId} --mode validate --apagar-notas=${apagarNotas}`)
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

function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  return ['1', 'true', 'sim', 'yes', 'y'].includes(String(value).toLowerCase())
}

function printHelp() {
  console.log(helpText())
}

function helpText() {
  return [
    'Uso:',
    '  npm run reset:operacional:fundo -- --fundo-id <uuid>',
    '',
    'Preview:',
    '  npm run reset:operacional:fundo -- --fundo-id <uuid> --mode preview',
    '',
    'Reset do banco, preservando Storage:',
    '  npm run reset:operacional:fundo -- --fundo-id <uuid> --mode reset --yes',
    '',
    'Reset do banco e remocao dos arquivos no Storage:',
    '  npm run reset:operacional:fundo -- --fundo-id <uuid> --mode reset --yes --delete-storage',
    '',
    'Validacao posterior:',
    '  npm run reset:operacional:fundo -- --fundo-id <uuid> --mode validate',
    '',
    'Opcoes:',
    '  --apagar-notas=true|false  true libera a chave de acesso para novo upload',
    '  --env-file <arquivo>       carrega um .env especifico antes de .env.homolog/.env.local/.env',
  ].join('\n')
}

function printResult(result) {
  if (!result || typeof result !== 'object') {
    console.log(result)
    return
  }

  console.log(`Fundo: ${result.fundo_nome ?? '-'} (${result.fundo_id ?? '-'})`)

  if (result.contagens) {
    console.log('\nPreview:')
    printObject(result.contagens)
  }

  if (result.contagens_antes) {
    console.log('\nAntes:')
    printObject(result.contagens_antes)
  }

  if (result.contagens_depois) {
    console.log('\nDepois:')
    printObject(result.contagens_depois)
  }

  const validationKeys = [
    'operacoes_restantes',
    'entregas_restantes',
    'remessas_restantes',
    'documentos_gerados_restantes',
    'notas_fiscais_restantes_do_fundo',
  ]

  const validation = Object.fromEntries(validationKeys
    .filter((key) => key in result)
    .map((key) => [key, result[key]]))

  if (Object.keys(validation).length > 0) {
    console.log('\nValidacao:')
    printObject(validation)
  }

  if (result.cadastros_preservados) {
    console.log('\nCadastros preservados:')
    printObject(result.cadastros_preservados)
  }

  const storageObjects = result.storage_objects ?? []
  if (storageObjects.length > 0) {
    console.log(`\nObjetos de Storage para remover via API: ${storageObjects.length}`)
    for (const item of storageObjects.slice(0, 20)) {
      console.log(`- ${item.bucket}/${item.storage_path}`)
    }
    if (storageObjects.length > 20) {
      console.log(`... +${storageObjects.length - 20} objetos`)
    }
  } else if (result.storage_objects) {
    console.log('\nNenhum objeto de Storage mapeado.')
  }
}

function printObject(object) {
  for (const [key, value] of Object.entries(object)) {
    console.log(`- ${key}: ${value}`)
  }
}

async function deleteStorageObjects(supabase, storageObjects) {
  if (!Array.isArray(storageObjects) || storageObjects.length === 0) {
    console.log('\nStorage: nenhum objeto para remover.')
    return
  }

  const grouped = new Map()
  for (const object of storageObjects) {
    if (!object?.bucket || !object?.storage_path) continue
    const paths = grouped.get(object.bucket) ?? []
    paths.push(object.storage_path)
    grouped.set(object.bucket, paths)
  }

  console.log('\nRemovendo objetos do Storage via API...')

  for (const [bucket, paths] of grouped.entries()) {
    const uniquePaths = [...new Set(paths)]
    for (let offset = 0; offset < uniquePaths.length; offset += 100) {
      const chunk = uniquePaths.slice(offset, offset + 100)
      const { error } = await supabase.storage.from(bucket).remove(chunk)
      if (error) throw new Error(`Falha ao remover Storage bucket=${bucket}: ${error.message}`)
      console.log(`- ${bucket}: ${Math.min(offset + chunk.length, uniquePaths.length)}/${uniquePaths.length}`)
    }
  }

  console.log('Storage removido.')
}

function formatSupabaseError(error) {
  const lines = [
    'Falha no reset operacional.',
    `Mensagem: ${error.message}`,
    error.code ? `SQLSTATE/codigo: ${error.code}` : null,
    error.details ? `Detalhes: ${error.details}` : null,
    error.hint ? `Hint: ${error.hint}` : null,
  ].filter(Boolean)

  if (error.code === 'PGRST202') {
    lines.push('')
    lines.push('A RPC reset_operacional_fundo_homolog nao existe no banco ou ainda nao entrou no schema cache do PostgREST.')
    lines.push('Aplique a migration supabase/migrations/20260723182639_reset_operacional_fundo_homolog_rpc.sql em homolog e rode novamente.')
    lines.push('Se a migration ja foi aplicada, aguarde alguns segundos ou recarregue o schema cache do PostgREST.')
  }

  return lines.join('\n')
}
