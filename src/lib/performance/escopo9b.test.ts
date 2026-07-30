import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260730190000_escopo9b_corrigir_isolamento_rls.sql'),
  'utf8',
)
const recurrenceMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260730200000_escopo9b_corrigir_recursao_sacado_rls.sql'),
  'utf8',
)
const explicitPoliciesMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260730194500_escopo9b_policies_explicitas.sql'),
  'utf8',
)
const verifier = readFileSync(
  resolve(process.cwd(), 'scripts/perf9a/verify-escopo9b-homolog.mjs'),
  'utf8',
)

describe('Escopo 9B — isolamento multifundo e carteira do consultor', () => {
  it('usa usuario_fundos e consultor_cedente como fontes de autorizacao', () => {
    expect(migration).toContain('private.usuario_tem_acesso_fundo')
    expect(migration).toContain('private.consultor_tem_acesso_cedente')
    expect(migration).toContain('uf.usuario_id = (SELECT auth.uid())')
    expect(migration).toContain('cc.consultor_id = (SELECT auth.uid())')
    expect(migration).not.toContain('cedentes.fundo_id')
  })

  it('restringe os objetos a authenticated e remove as policies permissivas anteriores', () => {
    expect(migration).toContain('TO authenticated')
    expect(migration).toContain('REVOKE ALL ON TABLE')
    expect(migration).toContain('FROM anon')
    expect(migration).toContain('DROP POLICY IF EXISTS fundos_gestor_all')
    expect(migration).toContain('DROP POLICY IF EXISTS operacoes_gestor_all')
    expect(migration).toContain('DROP POLICY IF EXISTS notas_fiscais_gestor_all')
    expect(migration).toContain('DROP POLICY IF EXISTS operacoes_nfs_gestor_all')
    expect(migration).not.toMatch(/CREATE POLICY\s+\w+_gestor_all[\s\S]{0,300}FOR ALL[\s\S]{0,300}get_user_role\(\)\s*=\s*'gestor'/i)
  })

  it('usa UPDATE USING e WITH CHECK para impedir troca de fundo', () => {
    expect(migration).toContain('CREATE POLICY operacoes_gestor_update')
    expect(migration).toContain('CREATE POLICY notas_fiscais_gestor_update')
    expect(migration).toContain('DROP POLICY IF EXISTS cedente_fundos_gestor_all')
    expect(migration).toContain('CREATE POLICY cedente_fundos_gestor_select')
    expect(migration).toContain('WITH CHECK')
    expect(migration).toContain('cf.fundo_id = notas_fiscais.fundo_id')
    expect(migration).toContain('cf.id = operacoes.cedente_fundo_id')
    expect(explicitPoliciesMigration).toContain('FOR INSERT TO authenticated')
    expect(explicitPoliciesMigration).toContain('FOR UPDATE TO authenticated')
    expect(explicitPoliciesMigration).toContain('FOR DELETE TO authenticated')
    expect(explicitPoliciesMigration).not.toContain('FOR ALL TO authenticated')
  })

  it('evita recursao entre operacoes e operacoes_nfs e normaliza CNPJ do sacado', () => {
    expect(recurrenceMigration).toContain('private.sacado_tem_acesso_operacao')
    expect(recurrenceMigration).toContain('private.sacado_tem_acesso_operacao_nf')
    expect(recurrenceMigration).toContain("regexp_replace(COALESCE(notas_fiscais.cnpj_destinatario, ''), '\\D', '', 'g')")
    expect(recurrenceMigration).toContain('DROP POLICY IF EXISTS operacoes_sacado_select')
    expect(recurrenceMigration).toContain('DROP POLICY IF EXISTS operacoes_nfs_sacado_select')
    expect(recurrenceMigration).toContain('SET search_path = pg_catalog, public')
  })

  it('mantem verificacao real com sessoes AAL2 e testes positivos/negativos por fundo', () => {
    expect(verifier).toContain("after.currentLevel !== 'aal2'")
    expect(verifier).toContain('gestor_multi')
    expect(verifier).toContain('consultor_b')
    expect(verifier).toContain('nao move operacao A para fundo B')
    expect(verifier).toContain('nao move NF A para fundo B')
    expect(verifier).toContain('dashboard gestor rejeita fundo B')
    expect(verifier).toContain('relatorio consultor nao retorna cedente B')
  })
})
