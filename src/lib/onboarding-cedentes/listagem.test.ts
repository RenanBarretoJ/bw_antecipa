import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildListUrl, buildPaginationMeta } from '@/lib/pagination'
import { parseFiltrosOnboarding, intervaloOnboarding } from './listagem'

describe('onboarding cedentes list filters', () => {
  it('uses the required pagination and queue defaults', () => {
    const filtros = parseFiltrosOnboarding({})
    expect(filtros).toMatchObject({
      pagina: 1,
      limite: 10,
      etapa: 'pendencias',
      busca: '',
      statusCadastral: null,
      politicaId: null,
      ordenacao: 'created_at',
      direcao: 'asc',
    })
  })

  it('accepts only page sizes 10, 20 and 40', () => {
    expect(parseFiltrosOnboarding({ pageSize: '10' }).limite).toBe(10)
    expect(parseFiltrosOnboarding({ pageSize: '20' }).limite).toBe(20)
    expect(parseFiltrosOnboarding({ pageSize: '40' }).limite).toBe(40)
    expect(parseFiltrosOnboarding({ pageSize: '50' }).limite).toBe(10)
  })

  it('normalizes search and rejects invalid filters and sorting', () => {
    const filtros = parseFiltrosOnboarding({
      q: '  Cedente   Exemplo  ',
      etapa: 'invalida',
      status: 'suspenso',
      politica: 'nao-e-uuid',
      sort: 'campo_invalido',
      direction: 'sideways',
    })
    expect(filtros.busca).toBe('Cedente Exemplo')
    expect(filtros.etapa).toBe('pendencias')
    expect(filtros.statusCadastral).toBeNull()
    expect(filtros.politicaId).toBeNull()
    expect(filtros.ordenacao).toBe('created_at')
    expect(filtros.direcao).toBe('asc')
  })

  it('builds an inclusive database range', () => {
    expect(intervaloOnboarding({ pagina: 3, limite: 20 })).toEqual({ from: 40, to: 59 })
  })

  it('preserves filters when changing pages', () => {
    expect(buildListUrl('/gestor/onboarding-cedentes', {
      q: 'cedente',
      status: 'ativo',
      politica: '00000000-0000-0000-0000-000000000001',
      sort: 'razao_social',
      direction: 'asc',
      page: '1',
    }, { page: 2 })).toBe(
      '/gestor/onboarding-cedentes?q=cedente&status=ativo&politica=00000000-0000-0000-0000-000000000001&sort=razao_social&direction=asc&page=2',
    )
  })

  it('adjusts out-of-range pages and represents an empty result', () => {
    expect(buildPaginationMeta({
      page: 9,
      pageSize: 10,
      total: 25,
      currentItemCount: 0,
    })).toMatchObject({ page: 3, requestedPage: 9, wasPageAdjusted: true })
    expect(buildPaginationMeta({
      page: 1,
      pageSize: 10,
      total: 0,
      currentItemCount: 0,
    })).toMatchObject({ page: 1, totalPages: 0, from: 0, to: 0 })
  })

  it('keeps the main route server-side and removes the seven client collections', () => {
    const pageSource = readFileSync(
      join(process.cwd(), 'src/app/gestor/onboarding-cedentes/page.tsx'),
      'utf8',
    )
    const clientSource = readFileSync(
      join(process.cwd(), 'src/components/onboarding-cedentes/OnboardingCedentesPage.tsx'),
      'utf8',
    )
    const loaderSource = readFileSync(
      join(process.cwd(), 'src/lib/onboarding-cedentes/listagem.server.ts'),
      'utf8',
    )

    expect(pageSource).not.toContain("'use client'")
    expect(pageSource.match(/carregarOnboardingCedentesPaginado\(filtros\)/g)).toHaveLength(1)
    expect(clientSource).not.toContain('createClient')
    expect(clientSource).not.toContain('montarCedentesOnboarding')
    expect(clientSource).not.toContain('filtrarCedentes')
    expect(loaderSource).not.toContain('createAdminClient')
    expect(loaderSource).not.toContain("select('*')")
  })

  it('applies authorization, filters and stable pagination inside the database function', () => {
    const migrationSource = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260729185443_performance_escopo2_onboarding_paginado.sql'),
      'utf8',
    )

    expect(migrationSource).toContain('SECURITY INVOKER')
    expect(migrationSource).toContain('public.usuario_fundos')
    expect(migrationSource).toContain('uf.usuario_id = v_user_id')
    expect(migrationSource).toContain('cfp.cedente_fundo_id = cf.id')
    expect(migrationSource).toContain("versao.status = 'publicada'")
    expect(migrationSource).toContain('p_status_cadastral IS NULL')
    expect(migrationSource).toContain('p_politica_id IS NULL')
    expect(migrationSource.indexOf('filtrados AS')).toBeLessThan(migrationSource.indexOf('OFFSET v_offset'))
    expect(migrationSource).toContain("CASE WHEN v_direction = 'asc' THEN id END ASC")
    expect(migrationSource).not.toContain('cedentes.fundo_id')
    expect(migrationSource).not.toContain('service_role')
  })

  it('loads modal and drawer context only after an explicit open action', () => {
    const dialogSource = readFileSync(
      join(process.cwd(), 'src/components/onboarding-cedentes/DefinirPoliticaDialog.tsx'),
      'utf8',
    )
    const drawerSource = readFileSync(
      join(process.cwd(), 'src/components/onboarding-cedentes/CedenteOnboardingDrawer.tsx'),
      'utf8',
    )
    const actionSource = readFileSync(
      join(process.cwd(), 'src/lib/actions/onboarding-cedentes.ts'),
      'utf8',
    )

    expect(dialogSource).toContain('if (!open || !cedente)')
    expect(drawerSource).toContain('if (!open || !cedente)')
    expect(dialogSource).toContain('carregarContextoOnboardingCedente(cedente.id)')
    expect(drawerSource).toContain('carregarContextoOnboardingCedente(cedente.id)')
    expect(actionSource).toContain("revalidatePath('/gestor/onboarding-cedentes')")
  })
})
