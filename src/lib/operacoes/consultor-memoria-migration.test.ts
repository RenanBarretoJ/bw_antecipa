import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('limita memória financeira à leitura com Cedente, Fundo e organização coerentes', () => {
  const sql = readFileSync('supabase/migrations/20261023143138_consultor_operacao_memoria_readonly.sql', 'utf8')
  expect(sql).toContain('FOR SELECT TO authenticated')
  expect(sql).toContain("(SELECT public.get_user_role()) = 'consultor'")
  expect(sql).toContain('private.consultor_tem_acesso_cedente(cedente_id)')
  expect(sql).toContain('cfu.consultor_id = cc.consultor_id')
  expect(sql).toContain('cu.user_id = (SELECT auth.uid())')
  expect(sql).toContain('cf.fundo_id = operacao_calculo_nfs.fundo_id')
  expect(sql).toContain('o.cedente_id = operacao_calculo_nfs.cedente_id')
  expect(sql).not.toMatch(/\b(GRANT|REVOKE|DISABLE|BYPASSRLS|SECURITY\s+DEFINER|DROP\s+POLICY|UPDATE\s+public|DELETE\s+FROM|INSERT\s+INTO)\b/i)
})
