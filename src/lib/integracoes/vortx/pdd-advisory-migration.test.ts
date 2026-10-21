import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(resolve('supabase/migrations', name), 'utf8').replace(/\r\n/g, '\n')
const migration = read('20261021144651_vortx_pdd_advisory_persistence.sql')
const completion = (sql: string) => sql.slice(sql.indexOf('FUNCTION public.vortx_concluir_processamento_estoque'), sql.indexOf(' resultado:=public.persistir_estoque_vortx'))

describe('VORTX_PDD_ADVISORY_V1 forward policy', () => {
  it('preserves the full canonical completion guard byte-for-byte', () => {
    const before = completion(read('20261020192527_vortx_stock_callback_processing.sql'))
    const after = completion(migration).replace(' reconciliado boolean; financeiro boolean; pdd_pendente boolean;', ' reconciliado boolean;')
    expect(after).toBe(before)
  })
  it('changes the history projection only to add the explicit warning, preserving its guards and ACLs', () => {
    const old = read('20261021123847_vortx_central_bases_history.sql')
    const oldPrivate = old.slice(old.indexOf('CREATE FUNCTION private.'), old.indexOf('CREATE FUNCTION public.')).trim()
    const newPrivate = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION private.vortx_central_bases_historico'), migration.indexOf('-- Reclassify only')).trim()
    expect(newPrivate.replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')
      .replace("    'pddPendente',COALESCE((i.metadados->>'pdd_pendente')::boolean,false),\n", '')).toBe(oldPrivate)
  })
  it('never replaces full reconciliation or publication, grants no new client write capability', () => {
    expect(migration).not.toMatch(/CREATE(?: OR REPLACE)? FUNCTION (?:public\.publicar_estoque_vortx|private\.vortx_estoque_reconciliado\()/)
    expect(migration).toContain('REVOKE ALL ON FUNCTION private.vortx_estoque_reconciliado_financeiro(uuid) FROM PUBLIC,anon,authenticated,service_role')
    expect(migration).not.toMatch(/UPDATE public\.vortx_posicao_|DISABLE ROW LEVEL SECURITY|UPDATE[^;]+publicada_em\s*=/)
    expect(migration).toContain("i.status='VALIDA' AND i.publicada_em IS NULL")
    expect(migration).toContain("'estado_anterior',r.estado,'estado_novo','PERSISTIDO'")
    expect(migration).toContain('VORTX_PDD_CONFERENCIA_ADIADA')
  })
})
