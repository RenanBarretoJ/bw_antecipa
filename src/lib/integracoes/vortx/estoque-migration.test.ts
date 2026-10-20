import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Git may check out CRLF on Windows; compare the complete SQL contract in canonical LF.
const migration = readFileSync('supabase/migrations/20261019192624_vortx_native_stock.sql', 'utf8').replace(/\r\n/g, '\n')
const baseline = JSON.parse(readFileSync('scripts/qa/vortx/__fixtures__/native-stock-functions-baseline.json', 'utf8')) as {
  functions: { name: string; definition: string }[]
}
const original = (name: string) => baseline.functions.find(f => f.name === name)!.definition

describe('extensao forward Vortx preserva contratos historicos', () => {
  it('publicador legado recebe somente fence Vortx e isolamento do namespace', () => {
    const expected = original('publicar_importacao_financeira')
      .replace('  PERFORM pg_advisory_xact_lock', `  IF v_importacao.provedor = 'VORTX' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Use o publicador de estoque nativo Vortx';
  END IF;
  PERFORM pg_advisory_xact_lock`)
      .replace("    AND i.status = 'PUBLICADA'", "    AND i.provedor <> 'VORTX'\n    AND i.status = 'PUBLICADA'")
    expect(migration).toContain(expected)
  })
  it('logistica conserva integralmente guards, contagens, matching e auditoria', () => {
    const expected = original('persistir_posicao_logistica_execucao')
      .replace('  v_reprocessamento boolean;', '  v_reprocessamento boolean;\n  v_vortx boolean;')
      .replace('SELECT i.data_referencia INTO v_data_referencia', "SELECT i.data_referencia, i.provedor = 'VORTX' INTO v_data_referencia, v_vortx")
      .replaceAll('FROM public.estoque_posicoes p', 'FROM public.estoque_fontes_leitura p')
      .replace('estoque_importacao_id, estoque_posicao_id,', 'estoque_importacao_id, estoque_posicao_id, vortx_posicao_parcela_id,')
      .replace("v_estoque_id, (v_item ->> 'estoque_posicao_id')::uuid,", `v_estoque_id,
      CASE WHEN NOT v_vortx THEN (v_item ->> 'estoque_posicao_id')::uuid END,
      CASE WHEN v_vortx THEN (v_item ->> 'estoque_posicao_id')::uuid END,`)
    expect(migration).toContain(expected)
  })
  it('usa RLS do chamador na view e nao edita policies legadas', () => {
    expect(migration).toContain('WITH (security_invoker=true)')
    expect(migration).not.toMatch(/DISABLE ROW LEVEL SECURITY|DROP POLICY|ALTER POLICY/i)
    expect(migration).toContain('logistica_fonte_exclusiva CHECK(num_nonnulls(estoque_posicao_id,vortx_posicao_parcela_id)=1)')
  })
})
