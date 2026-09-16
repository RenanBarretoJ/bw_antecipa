import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve('supabase/migrations/20260916140000_corrigir_overlay_exposicao_parcelas.sql'), 'utf8')

describe('persistir_exposicao_execucao: valor canonico do overlay', () => {
  it('confere o total das parcelas por fundo, operacao e NF, sem aceitar valores ausentes', () => {
    expect(migration).toContain("c.operacao_id=(v_item->>'operacao_id')::uuid")
    expect(migration).toContain("c.nota_fiscal_id=(v_item->>'nota_fiscal_id')::uuid AND c.fundo_id=v_fundo_id")
    expect(migration).toContain('GROUP BY c.operacao_id,c.nota_fiscal_id,c.fundo_id')
    expect(migration).toContain('HAVING count(*)=count(c.valor_presente)')
    expect(migration).toContain("AND sum(c.valor_presente)=(v_item->>'valor_aquisicao')::numeric")
    expect(migration).not.toContain("AND c.valor_presente=(v_item->>'valor_aquisicao')::numeric")
  })

  it('preserva guarda interna, pertencimento, idempotencia, auditoria e grant restrito', () => {
    expect(migration).toContain('private.financeiro_chamada_service_role()')
    expect(migration).toContain('cf.fundo_id=v_fundo_id')
    expect(migration).toContain("IF FOUND THEN RETURN v_execucao_id; END IF;")
    expect(migration).toContain('INSERT INTO public.logs_auditoria')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.persistir_exposicao_execucao(jsonb) FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.persistir_exposicao_execucao(jsonb) TO service_role')
  })
})
