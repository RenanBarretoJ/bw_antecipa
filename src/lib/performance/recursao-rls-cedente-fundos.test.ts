import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260804171538_corrigir_recursao_rls_cedente_fundos.sql'),
  'utf8',
)
const onboardingAction = readFileSync(
  resolve(process.cwd(), 'src/lib/actions/onboarding-cedentes.ts'),
  'utf8',
)
const linkService = readFileSync(
  resolve(process.cwd(), 'src/lib/fundos/cedente-fundo.ts'),
  'utf8',
)
const behavioralVerifier = readFileSync(
  resolve(process.cwd(), 'scripts/perf9a/verify-recursao-rls-cedente-fundos-homolog.mjs'),
  'utf8',
)

describe('correcao da recursao RLS entre cedente_fundos e fundos', () => {
  it('remove as consultas cruzadas das policies e usa helpers privados', () => {
    const insertPolicy = migration.match(/CREATE POLICY cedente_fundos_gestor_insert[\s\S]*?;\s*/)?.[0]
    const updatePolicy = migration.match(/CREATE POLICY cedente_fundos_gestor_update[\s\S]*?;\s*/)?.[0]
    const cedenteFundPolicy = migration.match(/CREATE POLICY fundos_cedente_vinculado_select[\s\S]*?;\s*/)?.[0]
    const consultantFundPolicy = migration.match(/CREATE POLICY fundos_consultor_vinculado_select[\s\S]*?;\s*/)?.[0]

    expect(insertPolicy).toContain('private.usuario_pode_administrar_fundo_ativo')
    expect(updatePolicy).toContain('private.usuario_pode_administrar_fundo_ativo')
    expect(insertPolicy).not.toContain('FROM public.fundos')
    expect(updatePolicy).not.toContain('FROM public.fundos')
    expect(cedenteFundPolicy).toContain('private.cedente_tem_acesso_fundo')
    expect(consultantFundPolicy).toContain('private.consultor_tem_acesso_fundo')
    expect(cedenteFundPolicy).not.toContain('FROM public.cedente_fundos')
    expect(consultantFundPolicy).not.toContain('FROM public.cedente_fundos')
  })

  it('deriva o ator de auth.uid e restringe SECURITY DEFINER', () => {
    expect(migration).toContain("SET search_path = ''")
    expect(migration).toContain('(SELECT auth.uid())')
    expect(migration).toContain("p.status::text = 'ativo'")
    expect(migration).toContain("uf.status = 'ativo'")
    expect(migration).toContain('FROM PUBLIC, anon, authenticated, service_role')
    expect(migration).toContain('TO authenticated')
    expect(migration).not.toMatch(/GRANT EXECUTE[^;]+TO\s+(?:PUBLIC|anon|service_role)/i)
  })

  it('nao cria excecao de dados nem contorna RLS na aplicacao', () => {
    expect(migration).not.toContain('PERF9A')
    expect(migration).not.toContain('FORMAPLAN')
    expect(migration).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(onboardingAction).toContain('vincularCedenteFundo(cedenteId, fundoId, context.supabase)')
    expect(linkService).toContain(".from('cedente_fundos')")
    expect(linkService).not.toContain('createAdminClient')
  })

  it('mantem teste comportamental transacional com matriz de atores', () => {
    expect(behavioralVerifier).toContain("SET LOCAL ROLE authenticated")
    expect(behavioralVerifier).toContain("SET LOCAL ROLE anon")
    expect(behavioralVerifier).toContain('gestor vinculado cria vinculo em seu fundo')
    expect(behavioralVerifier).toContain('gestor de B nao cria vinculo em A')
    expect(behavioralVerifier).toContain('cedente nao cria o proprio vinculo')
    expect(behavioralVerifier).toContain('consultor nao cria vinculo')
    expect(behavioralVerifier).toContain('duplicidade do mesmo par permanece bloqueada')
    expect(behavioralVerifier).toContain("await client.query('ROLLBACK')")
  })
})
