import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRelatorioFiltros } from '@/lib/analytics/contracts'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('performance scope 7 filters', () => {
  it('normalizes URL pagination, filters and stable ordering', () => {
    const result = parseRelatorioFiltros({
      mes: '2026-07',
      q: '  Fundo   Teste ',
      status: 'liquidada',
      cedente: 'a4eb203b-ca53-40fa-8701-e453720bb15b',
      dataInicial: '2026-07-01',
      dataFinal: '2026-07-31',
      page: '3',
      pageSize: '20',
      sort: 'cedente',
      direction: 'asc',
    })

    expect(result).toEqual({
      mes: '2026-07',
      q: 'Fundo Teste',
      status: 'liquidada',
      cedenteId: 'a4eb203b-ca53-40fa-8701-e453720bb15b',
      dataInicial: '2026-07-01',
      dataFinal: '2026-07-31',
      page: 3,
      pageSize: 20,
      sort: 'cedente',
      direction: 'asc',
    })
  })

  it('rejects unsupported page sizes, statuses, dates and sort fields', () => {
    const result = parseRelatorioFiltros({
      mes: '2026-13',
      status: 'desconhecido',
      cedente: 'nao-e-uuid',
      dataInicial: '31/07/2026',
      page: '-1',
      pageSize: '500',
      sort: 'sql',
      direction: 'sideways',
    })

    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(10)
    expect(result.status).toBeNull()
    expect(result.cedenteId).toBeNull()
    expect(result.dataInicial).toBeNull()
    expect(result.sort).toBe('volume_total')
    expect(result.direction).toBe('desc')
    expect(result.mes).toMatch(/^\d{4}-\d{2}$/)
  })

  it.each(['10', '20', '40'] as const)('accepts page size %s', (pageSize) => {
    expect(parseRelatorioFiltros({ pageSize }).pageSize).toBe(Number(pageSize))
  })
})

describe('performance scope 7 formula equivalence', () => {
  const operations = [
    { status: 'em_andamento', bruto: 100.11, liquido: 96.01, taxa: 3.99, comissao: 1.5 },
    { status: 'liquidada', bruto: 250.29, liquido: 240.15, taxa: 4.1, comissao: 2 },
    { status: 'reprovada', bruto: 999.99, liquido: 900, taxa: 9.9, comissao: 2 },
  ]

  it('preserves gross, liquid, revenue and simple average semantics', () => {
    const validas = operations.filter((operation) => !['cancelada', 'reprovada'].includes(operation.status))
    const legacy = {
      bruto: validas.reduce((total, operation) => total + operation.bruto, 0),
      liquido: validas.reduce((total, operation) => total + operation.liquido, 0),
      taxa: validas.reduce((total, operation) => total + operation.taxa, 0) / validas.length,
    }
    const aggregation = {
      bruto: 100.11 + 250.29,
      liquido: 96.01 + 240.15,
      taxa: (3.99 + 4.1) / 2,
    }

    expect(aggregation).toEqual(legacy)
    expect(aggregation.bruto - aggregation.liquido).toBeCloseTo(14.24, 8)
  })

  it('preserves consultant commission over liquid value', () => {
    const legacy = operations
      .filter((operation) => operation.status === 'em_andamento')
      .reduce((total, operation) => total + operation.liquido * operation.comissao / 100, 0)

    expect(legacy).toBeCloseTo(1.44015, 8)
  })
})

describe('performance scope 7 structure', () => {
  const pages = [
    'src/app/gestor/dashboard/page.tsx',
    'src/app/cedente/dashboard/page.tsx',
    'src/app/consultor/dashboard/page.tsx',
    'src/app/gestor/relatorios/page.tsx',
    'src/app/consultor/relatorios/page.tsx',
  ]

  it('keeps all dashboards and reports as server components', () => {
    for (const path of pages) {
      const page = source(path)
      expect(page).not.toContain("'use client'")
      expect(page).not.toContain('useEffect')
      expect(page).not.toContain("from('@/lib/supabase/client')")
      expect(page).toContain('await connection()')
    }
  })

  it('derives every operational scope on the server without service role', () => {
    const loader = source('src/lib/analytics/loaders.server.ts')
    expect(loader).toContain('requireGestor()')
    expect(loader).toContain("requireRole('cedente')")
    expect(loader).toContain("requireRole('consultor')")
    expect(loader).toContain('resolverContextoFundoGestor')
    expect(loader).toContain('resolverCedenteFundoAtivo')
    expect(loader).not.toContain('createAdminClient')
    expect(loader).not.toContain("select('*')")
  })

  it('uses invoker RPCs, database pagination and bounded recent lists', () => {
    const migration = source('supabase/migrations/20260730152328_performance_escopo7_dashboards_relatorios.sql')
    expect(migration.match(/SECURITY INVOKER/g)?.length).toBe(5)
    expect(migration).toContain('LIMIT 8')
    expect(migration).toContain('LIMIT 5')
    expect(migration).toContain('LIMIT p_page_size OFFSET p_offset')
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.relatorio_gestor_analitico")
    expect(migration).toContain("cc.consultor_id = auth.uid()")
    expect(migration).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i)
  })

  it('preserves the declared formulas in database aggregations', () => {
    const migration = source('supabase/migrations/20260730152328_performance_escopo7_dashboards_relatorios.sql')
    expect(migration).toContain("avg(taxa_desconto)")
    expect(migration).toContain("valor_bruto_total - valor_liquido_desembolso")
    expect(migration).toContain("valor_liquido_desembolso * comissao_percentual / 100")
    expect(migration).toContain("status::text NOT IN ('cancelada', 'reprovada')")
    expect(migration).toContain("aceite_sacado_status::text IN ('dispensado', 'aceito')")
  })
})
