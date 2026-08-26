import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20260826211301_p4_remessas_operacionais_adapter.sql'), 'utf8')
const indexMigration = readFileSync(join(process.cwd(), 'supabase/migrations/20260826211522_p4_index_remessas_gerado_por.sql'), 'utf8')

describe('P4 - persistencia generica de remessas', () => {
  it('persiste lote, sub-remessas, operacoes e chaves estaveis', () => {
    expect(migration).toContain('CREATE TABLE public.remessas_operacionais')
    expect(migration).toContain('CREATE TABLE public.remessa_operacional_arquivos')
    expect(migration).toContain('CREATE TABLE public.remessa_operacional_operacoes')
    expect(migration).toContain('CREATE TABLE public.remessa_operacional_chaves')
    expect(migration).toContain("estrategia_agrupamento IN ('POR_LOTE', 'POR_CEDENTE')")
    expect(migration).toContain('UNIQUE NULLS NOT DISTINCT (remessa_operacional_arquivo_id, operacao_id, nota_fiscal_id, parcela_id)')
  })

  it('habilita RLS, revoga mutacoes do authenticated e indexa todas as FKs de consulta', () => {
    expect(migration.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(4)
    expect(migration).toContain('REVOKE ALL ON TABLE public.remessas_operacionais FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('GRANT SELECT ON TABLE public.remessas_operacionais TO authenticated')
    expect(migration).toContain('remessas_operacionais_integracao_versao_idx')
    expect(migration).toContain('remessa_operacional_chaves_parcela_idx')
    expect(indexMigration).toContain('remessas_operacionais_gerado_por_idx')
  })
})
