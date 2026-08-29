#!/usr/bin/env node

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadEnvFile } from '../../../perf9a/common.mjs'

loadEnvFile('.env.homolog')

const expectedProjectRef = 'fhgkmggthxikfpogrvaa'
const target = process.argv[2]
if (!target) throw new Error('Informe o runner que deve ser executado.')

const apiRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname.split('.')[0]
if (apiRef !== expectedProjectRef) throw new Error(`Projeto bloqueado: ${apiRef || 'desconhecido'}`)

const configured = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || ''
const rotatedPassword = process.env.SUPABASE_PASSWORD || ''
if (!configured || !rotatedPassword) throw new Error('Credencial PostgreSQL direta de homologacao incompleta.')

const databaseUrl = new URL(configured)
if (!`${databaseUrl.hostname} ${decodeURIComponent(databaseUrl.username)}`.includes(expectedProjectRef)) {
  throw new Error('A conexao PostgreSQL nao aponta para o projeto de homologacao autorizado.')
}
databaseUrl.password = rotatedPassword
process.env.SUPABASE_DB_URL = databaseUrl.toString()
process.env.DATABASE_URL = databaseUrl.toString()
process.argv = [process.argv[0], resolve(target), ...process.argv.slice(3)]

await import(pathToFileURL(resolve(target)).href)
