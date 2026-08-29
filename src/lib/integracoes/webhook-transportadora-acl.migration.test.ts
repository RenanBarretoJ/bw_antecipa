import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260824210000_corrigir_acl_webhook_transportadora_service_role.sql'),
  'utf8',
)

describe('ACL server-side do webhook de transportadora', () => {
  it('concede somente as leituras exigidas ao service_role', () => {
    expect(migration).toContain(
      'GRANT SELECT ON TABLE public.integracoes_transportadoras TO service_role;',
    )
    expect(migration).toContain(
      'GRANT SELECT ON TABLE public.integracao_logistica_webhook_eventos TO service_role;',
    )
    expect(migration).toContain(
      'GRANT SELECT ON TABLE public.nota_fiscal_remessas TO service_role;',
    )
    expect(migration.match(/GRANT SELECT ON TABLE/g)).toHaveLength(3)
  })

  it('nao amplia escrita, papeis publicos ou politicas RLS', () => {
    expect(migration).not.toMatch(/\bTO\s+(anon|authenticated|PUBLIC)\b/i)
    expect(migration).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)/i)
    expect(migration).not.toMatch(/CREATE\s+POLICY|ALTER\s+POLICY|DISABLE\s+ROW\s+LEVEL\s+SECURITY/i)
  })
})
