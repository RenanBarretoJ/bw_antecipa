import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8').replace(/\r\n/g, '\n')
const base = read('20261019192624_vortx_native_stock')
const forward = read('20261020192527_vortx_stock_callback_processing')

describe('bounded transport preserves the complete native persistence contract', () => {
  it('changes only row/count access and adds the staged lease validation after authorization', () => {
    const original = base.slice(base.indexOf('CREATE FUNCTION public.persistir_estoque_vortx('),
      base.indexOf('REVOKE ALL ON FUNCTION public.persistir_estoque_vortx('))
    const expected = original.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
      .replace(" END IF;\n IF NOT EXISTS (", " END IF;\n IF p_payload ? 'processamento_id' THEN PERFORM private.vortx_validar_payload_estagiado(p_payload); END IF;\n IF NOT EXISTS (")
      .replaceAll("jsonb_array_length(p_payload->'ativos')", "private.vortx_linhas_quantidade(p_payload,'ativos')")
      .replaceAll("jsonb_array_length(p_payload->'parcelas')", "private.vortx_linhas_quantidade(p_payload,'parcelas')")
      .replaceAll("jsonb_array_elements(p_payload->'ativos')", "private.vortx_linhas_importacao(p_payload,'ativos')")
      .replaceAll("jsonb_array_elements(p_payload->'parcelas')", "private.vortx_linhas_importacao(p_payload,'parcelas')")
    expect(forward).toContain(expected)
    expect(forward).not.toMatch(/DISABLE ROW LEVEL SECURITY|DROP POLICY|ALTER POLICY/i)
  })
})
