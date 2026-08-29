import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

const migrationPath =
  'supabase/migrations/20260730170007_performance_escopo8_hardening_grants_rls.sql'

describe('performance scope 8 security closeout', () => {
  const performanceRpcs = [
    'listar_onboarding_cedentes_paginado',
    'carregar_dashboard_sacado',
    'carregar_indicadores_nfs_sacado',
    'listar_cedentes_aprovacao_sacado',
    'listar_documentos_atuais_cedente',
    'dashboard_gestor_resumo',
    'dashboard_cedente_resumo',
    'dashboard_consultor_resumo',
    'relatorio_gestor_analitico',
    'relatorio_consultor_analitico',
  ]

  it('enables RLS and removes anonymous table access from cedente rates', () => {
    const migration = source(migrationPath)

    expect(migration).toContain('ALTER TABLE public.taxas_cedente ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL ON TABLE public.taxas_cedente FROM anon')
    expect(migration).toContain('taxas_cedente_cedente_select')
    expect(migration).toContain('taxas_cedente_gestor_all')
    expect(migration).toContain("uf.status = 'ativo'")
  })

  it.each(performanceRpcs)(
    'keeps %s available only to authenticated callers',
    (functionName) => {
      const migration = source(migrationPath)
      const functionStart = migration.indexOf(`FUNCTION public.${functionName}`)

      expect(functionStart).toBeGreaterThan(-1)
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${functionName}`)
      expect(migration).toMatch(
        new RegExp(
          `REVOKE EXECUTE ON FUNCTION public\\.${functionName}\\([\\s\\S]*?\\)\\s+FROM PUBLIC, anon;`,
        ),
      )
    },
  )

  it('does not broaden access to service-role or public callers', () => {
    const migration = source(migrationPath)

    expect(migration).not.toMatch(/GRANT EXECUTE[\s\S]*?TO (?:PUBLIC|anon|service_role);/)
    expect(migration).not.toMatch(/GRANT (?:ALL|SELECT)[\s\S]*?TO anon;/)
  })

  it('persists cedente notifications in one batch instead of one insert per user', () => {
    const action = source('src/lib/actions/notificacao.ts')
    const notificarCedente = action.slice(
      action.indexOf('export async function notificarCedente'),
      action.indexOf('export async function notificarGestores'),
    )

    expect(notificarCedente).not.toContain('userIds.map(async')
    expect(notificarCedente).toContain('const notificacoesLote = userIds.map')
    expect(notificarCedente).toContain('.insert(notificacoesLote as never[])')
    expect(notificarCedente).toContain('.upsert(notificacoesLote as never[]')
  })
})
