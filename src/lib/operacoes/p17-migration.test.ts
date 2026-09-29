import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/20260929141740_p17_360_dias_corridos.sql', 'utf8')
const client = readFileSync('src/app/gestor/operacoes/[id]/OperacaoDetalheGestorClient.tsx', 'utf8')

describe('P17 limites de rollout e historico', () => {
  it('altera somente os cinco pontos de calculo/reparo e nao faz backfill', () => {
    expect([...sql.matchAll(/CREATE OR REPLACE FUNCTION ([^(]+)/g)].map((m) => m[1])).toEqual([
      'private.calcular_memoria_financeira_nf', 'public.preparar_contexto_calculo_nova_operacao',
      'public.aprovar_operacao_atomica_financeiro_v1', 'public.solicitar_operacao_antecipacao_consultor_atomica',
      'private.recalcular_previa_operacao_p17',
    ])
    const outsideFunctions = sql.replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g, '')
    expect(outsideFunctions).not.toMatch(/\b(UPDATE|DELETE|INSERT|TRUNCATE)\s/i)
    expect(sql).not.toContain('least(extract(day')
    expect(sql).toContain('dias_aplicados := dias_corridos;')
  })
  it('reparo nao aprova nem reescreve snapshot e nao e acessivel a clientes', () => {
    const repair = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION private.recalcular_previa_operacao_p17'))
    expect(repair).toContain('SECURITY INVOKER')
    expect(repair).toContain('FOR UPDATE OF o')
    expect(repair).toContain('op.updated_at IS DISTINCT FROM p_expected_updated_at')
    expect(repair).toContain("op.status NOT IN ('solicitada', 'em_analise')")
    expect(repair).toContain('FROM PUBLIC,anon,authenticated,service_role')
    expect(repair).not.toMatch(/UPDATE public.notas_fiscais|politica_snapshot\s*=|taxa_desconto\s*=|status\s*=/)
    expect(repair).toContain('OPERACAO_PREVIA_RECALCULADA_P17')
  })
  it('gestor simula apenas editaveis e usa a mesma previa no total e na decisao', () => {
    expect(client.match(/if \(!\['solicitada', 'em_analise'\].includes\(op.status\)\) return null/g)).toHaveLength(2)
    expect(client).toContain('antecipado: op &&')
    expect(client).toContain('? calculoFinanceiro?.valorLiquidoTotal ?? null')
  })
})
