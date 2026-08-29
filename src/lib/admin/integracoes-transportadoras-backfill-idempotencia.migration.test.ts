import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260824190000_p1_corrigir_idempotencia_backfill_token.sql'),
  'utf8',
)

describe('contrato da migration corretiva de idempotencia do backfill de token', () => {
  it('e transacional', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('COMMIT;')
  })

  it('so executa o backfill/drop se a coluna token_hash ainda existir -- nunca falha ao reaplicar depois que ja foi removida', () => {
    expect(migration).toContain("SELECT 1 FROM information_schema.columns")
    expect(migration).toContain("column_name = 'token_hash'")
    const posGuard = migration.indexOf('IF EXISTS (')
    const posInsert = migration.indexOf('INSERT INTO public.integracoes_transportadoras_tokens')
    const posDropColumn = migration.indexOf("DROP COLUMN IF EXISTS token_hash")
    expect(posGuard).toBeGreaterThan(-1)
    expect(posInsert).toBeGreaterThan(posGuard)
    expect(posDropColumn).toBeGreaterThan(posInsert)
  })

  it('usa EXECUTE (SQL dinamico) para o backfill -- uma referencia direta a coluna falharia no parse mesmo dentro do IF', () => {
    expect(migration).toMatch(/EXECUTE \$sql\$[\s\S]*INSERT INTO public\.integracoes_transportadoras_tokens/)
  })

  it('preserva a mesma logica de backfill da migration original (status ativo/revogado conforme o campo ativo, ON CONFLICT DO NOTHING)', () => {
    expect(migration).toContain("CASE WHEN ativo THEN 'ativo' ELSE 'revogado' END")
    expect(migration).toContain('ON CONFLICT (token_hash) DO NOTHING')
  })
})
