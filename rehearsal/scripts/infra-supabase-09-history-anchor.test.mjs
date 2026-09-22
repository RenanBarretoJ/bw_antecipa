import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const anchorPath = path.join(
  repositoryRoot,
  'supabase',
  'migrations',
  '20260827150923_corrigir_ambiguidade_excluir_usuarios_homolog.sql',
)
const forwardPath = path.join(
  repositoryRoot,
  'supabase',
  'migrations',
  '20260922161558_reconcile_runtime_policies_reset_functions_grants.sql',
)

test('historical anchor preserves the remote version without recreating the homolog helper', () => {
  const anchor = fs.readFileSync(anchorPath, 'utf8')

  assert.match(anchor, /Historical anchor recovered from the homolog migration history/u)
  assert.match(anchor, /DO \$\$[\s\S]*?NULL;[\s\S]*?END[\s\S]*?\$\$;/u)
  assert.doesNotMatch(anchor, /create\s+(?:or\s+replace\s+)?function/iu)
  assert.doesNotMatch(anchor, /excluir_usuarios_homolog\s*\(/iu)
  assert.doesNotMatch(anchor, /\b(?:insert|update|delete|truncate)\b/iu)
})

test('forward migration remains responsible for removing the noncanonical helper', () => {
  const forward = fs.readFileSync(forwardPath, 'utf8')

  assert.match(forward, /n\.nspname = 'private' and p\.proname = 'excluir_usuarios_homolog'/u)
  assert.match(forward, /execute format\('drop function %s restrict', v_function\)/u)
})
