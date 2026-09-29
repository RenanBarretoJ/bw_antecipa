import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8').replace(/\r\n/g, '\n')
const migration = read('20260929215557_guibor_a6_decouple_c5')
const sql = migration.replace(/--[^\n]*/g, '')

describe('A6 R2 analitico independente de C5', () => {
  it('preserva o arquivo A6 ja aplicado', () => {
    expect(createHash('sha256').update(read('20260929193129_guibor_a6_comissao_por_fundo')).digest('hex'))
      .toBe('99339e4385d23dd13bd97bf6b5bb864c439a3d9568125de2306058fbdb655bb3')
  })

  it('usa C1.1 sem predicados de visualizacao ou policies C5', () => {
    expect(sql).toContain('private.consultor_organizacao_ativa_do_usuario(auth.uid())')
    expect(sql).toContain("private.consultor_usuario_tem_papel(auth.uid(), ARRAY['OWNER','ADMIN','OPERADOR','LEITOR'])")
    expect(sql).not.toMatch(/consultor_usuario_pode_visualizar_|\b(?:CREATE|ALTER|DROP) POLICY\b|DISABLE ROW LEVEL SECURITY/i)
  })

  it('isola por vinculo exato e nao concede o helper de escopo', () => {
    expect(sql.match(/cf.cedente_fundo_id=o.cedente_fundo_id/g)).toHaveLength(2)
    expect(sql.match(/cf.cedente_id=o.cedente_id/g)).toHaveLength(2)
    expect(sql).toContain('REVOKE ALL ON FUNCTION private.consultor_escopo_analitico() FROM PUBLIC, anon, authenticated, service_role')
    expect(sql).not.toMatch(/GRANT .* ON (?:TABLE )?public\./i)
  })

  it('mantem wrappers invoker e padrao OFF sem backfill financeiro', () => {
    expect(sql.match(/RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''/g)).toHaveLength(2)
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS comissao_habilitada boolean NOT NULL DEFAULT false')
    expect(sql).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM) public\.(?:operacoes|notas_fiscais|operacao_calculo_nfs)\b/i)
  })

  it('conserva formula e remove campos OFF no servidor', () => {
    expect(sql).toContain('valor_liquido_desembolso * comissao_percentual / 100')
    expect(sql).toContain("v_result := v_result - 'comissaoEstimada'")
    expect(sql).toContain("(v_result->'resumo')-'comissaoMes'")
  })
})
