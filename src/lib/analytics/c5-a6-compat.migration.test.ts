import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assertCheckoutIdentity } from '../../../scripts/qa/reconciliation/r1-19-checkout-integrity'

const file = 'supabase/migrations/20261006210815_c5_reader_a6_compat.sql'
const source = readFileSync(file, 'utf8')
const sql = source.replace(/--[^\n]*/g, '')
const manifest = JSON.parse(readFileSync('scripts/qa/reconciliation/r1-3-path-manifests.json', 'utf8'))
const canonical = JSON.parse(readFileSync('scripts/qa/reconciliation/ci/contracts.json', 'utf8')).canonical.entries as (Entry & { source_kind: string })[]
type Entry = {path: string; version: string; sha256: string; classification: string}

describe('C5/A6 forward compatibility', () => {
  it('preserves analytics rather than recreating historical C5 wrappers', () => {
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION (?:public|private)\.(?:dashboard_consultor_resumo|relatorio_consultor_analitico|consultor_escopo_analitico)/i)
    expect(sql).toContain('C5_A6_COMPAT_A6_SECURITY_DRIFT')
    expect(sql).toContain('C5_A6_COMPAT_A6_WRAPPER_DRIFT')
    expect(sql).not.toMatch(/GRANT[^;]*(?:dashboard_consultor_resumo|relatorio_consultor_analitico)/i)
  })
  it('has no business-data backfill or migration-history repair', () => {
    expect(sql).not.toMatch(/\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:public|private|supabase_migrations)\./i)
    expect(sql).not.toContain('comissao_habilitada=')
    expect(sql).not.toMatch(/DISABLE (?:TRIGGER|ROW LEVEL SECURITY)|session_replication_role/i)
  })
  it('changes only SELECT policies and secures every new function search path', () => {
    expect(sql.match(/CREATE POLICY/g)).toHaveLength(11)
    expect(sql.match(/FOR SELECT TO authenticated/g)).toHaveLength(11)
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(15)
    expect(sql.match(/SET search_path = ''/g)).toHaveLength(15)
    expect(sql).not.toMatch(/(?:CREATE|DROP|ALTER) POLICY[^;]* ON (?:storage\.|public\.(?:sacados|sacado_acessos|notificacoes))/i)
  })
  it('keeps standalone event access operational, with exact fund binding', () => {
    const policy = sql.slice(sql.indexOf('CREATE POLICY eventos_dominio_consultor_select'))
    expect(policy).toContain('eventos_dominio.operacao_id IS NULL')
    expect(policy).toContain('private.consultor_usuario_pode_operar_cedente(')
    expect(policy).toContain('private.consultor_usuario_pode_visualizar_cedente_fundo(')
    expect(policy).toContain('cf.fundo_id = eventos_dominio.fundo_id')
  })
  it('production applies only the forward for C5/A6, not historical files', () => {
    const entries = manifest.PROD_TO_RECONCILED_UPGRADE as Entry[]
    expect(entries.filter(e => e.classification === 'APPLY_REQUIRED').map(e => e.path)).toEqual([file])
    for (const version of ['20260925212843','20260928130825','20260928143646']) {
      expect(entries.find(e => e.version === version)?.classification).toBe('SUPERSEDED_BY_FORWARD_COMPAT')
    }
    expect(entries.find(e => e.version === '20260929193129')?.classification).toBe('INTENTIONAL_EXCEPTION_DO_NOT_APPLY')
    expect(entries.find(e => e.version === '20260929215557')?.classification).toBe('ALREADY_APPLIED')
  })
  it('homolog skips its historical C5/A6; clean-room explicitly permits that history', () => {
    const homolog = manifest.HOMOLOG_TO_RECONCILED_UPGRADE as Entry[]
    expect(homolog.filter(e => e.classification === 'APPLY_REQUIRED').map(e => e.path)).toEqual([file])
    expect(homolog.find(e => e.version === '20260929193129')?.classification).toBe('ALREADY_APPLIED_HISTORICAL_HOMOLOG_ONLY')
    expect((manifest.CLEAN_ROOM_CANONICAL as Entry[]).map(e => e.version)).toEqual([
      '20260925212843','20260928130825','20260928143646','20260929193129','20260929215557','20261006210815',
    ])
  })
  it('all explicit path entries retain canonical hashes and exact legacy representation hashes', () => {
    for (const key of ['PROD_TO_RECONCILED_UPGRADE','HOMOLOG_TO_RECONCILED_UPGRADE','CLEAN_ROOM_CANONICAL']) {
      for (const entry of manifest[key] as Entry[]) {
        const sources = canonical.filter(source => source.path === entry.path && source.version === entry.version)
        expect(sources).toHaveLength(1)
        assertCheckoutIdentity(readFileSync(entry.path), entry, sources[0])
      }
    }
  })
})
