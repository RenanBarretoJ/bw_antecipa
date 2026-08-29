import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260804103235_corrigir_reset_postergacoes_canhoto.sql'),
  'utf8',
)
const baseMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260728153646_reset_operacional_eventos_dominio.sql'),
  'utf8',
)
const recentDependenciesMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260811153000_corrigir_reset_dependencias_logisticas_duplicatas.sql'),
  'utf8',
)
const installer = readFileSync(join(process.cwd(), 'scripts/install-reset-operacional-rpc.mjs'), 'utf8')
const resetFunctionPattern = /create\s+or\s+replace\s+function\s+public\.reset_operacional_fundo_homolog\s*\([\s\S]+?\r?\n\$\$;/i

describe('reset operacional com postergacoes de entrega', () => {
  it('remove a dependencia imutavel antes de executar o reset base', () => {
    const deleteIndex = migration.indexOf('delete from public.nota_fiscal_entrega_postergacoes_canhoto')
    const baseResetIndex = migration.indexOf('v_resultado := public.reset_operacional_fundo_homolog_sem_postergacoes')

    expect(migration).toContain('disable trigger postergacao_upload_canhoto_append_only')
    expect(migration).toContain('enable trigger postergacao_upload_canhoto_append_only')
    expect(deleteIndex).toBeGreaterThan(-1)
    expect(baseResetIndex).toBeGreaterThan(deleteIndex)
  })

  it('mantem a funcao base inacessivel e expoe somente o wrapper ao service role', () => {
    expect(migration).toContain('reset_operacional_fundo_homolog_sem_postergacoes')
    expect(migration).toContain('from public, anon, authenticated, service_role')
    expect(migration).toContain('to service_role')
  })

  it('reinstala a base atual e a correcao sem regredir a RPC', () => {
    expect(installer).toContain('20260728153646_reset_operacional_eventos_dominio.sql')
    expect(installer).toContain('20260804103235_corrigir_reset_postergacoes_canhoto.sql')
    expect(installer).toContain('20260811153000_corrigir_reset_dependencias_logisticas_duplicatas.sql')
    expect(installer).toContain('DROP FUNCTION IF EXISTS public.reset_operacional_fundo_homolog_sem_postergacoes')
    expect(installer).toContain('DROP FUNCTION IF EXISTS public.reset_operacional_fundo_homolog_sem_dependencias_recentes')
  })

  it('extrai a funcao das migrations independentemente da capitalizacao SQL', () => {
    expect(baseMigration.match(resetFunctionPattern)?.[0]).toContain('reset_operacional_fundo_homolog')
    expect(migration.match(resetFunctionPattern)?.[0]).toContain('reset_operacional_fundo_homolog')
    expect(recentDependenciesMigration.match(resetFunctionPattern)?.[0]).toContain('reset_operacional_fundo_homolog')
    expect(installer).toContain('/create\\s+or\\s+replace\\s+function')
    expect(installer).toContain('\\$\\$;/i')
  })

  it('remove memorias logisticas antes de excluir analises documentais no reset base', () => {
    const deleteMemoriasIndex = recentDependenciesMigration.indexOf('delete from public.operacao_nf_logistica_memorias')
    const baseResetIndex = recentDependenciesMigration.indexOf(
      'v_resultado := public.reset_operacional_fundo_homolog_sem_dependencias_recentes',
    )

    expect(recentDependenciesMigration).toContain('disable trigger operacao_nf_logistica_memoria_append_only')
    expect(recentDependenciesMigration).toContain('enable trigger operacao_nf_logistica_memoria_append_only')
    expect(deleteMemoriasIndex).toBeGreaterThan(-1)
    expect(baseResetIndex).toBeGreaterThan(deleteMemoriasIndex)
  })

  it('remove evidencias logisticas na ordem das chaves estrangeiras', () => {
    const deleteVersoesIndex = recentDependenciesMigration.indexOf('delete from public.evidencia_logistica_versoes')
    const deleteEvidenciasIndex = recentDependenciesMigration.indexOf('delete from public.evidencias_logisticas_antecipadas')

    expect(deleteVersoesIndex).toBeGreaterThan(-1)
    expect(deleteEvidenciasIndex).toBeGreaterThan(deleteVersoesIndex)
  })

  it('remove duplicatas e inclui seus arquivos na compensacao de Storage', () => {
    const deleteVersoesIndex = recentDependenciesMigration.indexOf('delete from public.duplicata_versoes')
    const deleteDuplicatasIndex = recentDependenciesMigration.indexOf('delete from public.duplicatas')

    expect(recentDependenciesMigration).toContain("'entidade_origem', 'duplicata_versoes'")
    expect(recentDependenciesMigration).toContain('disable trigger duplicata_versoes_append_only')
    expect(deleteVersoesIndex).toBeGreaterThan(-1)
    expect(deleteDuplicatasIndex).toBeGreaterThan(deleteVersoesIndex)
  })
})
