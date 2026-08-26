import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260826100000_p0_webhook_transportadora_payload_auditoria.sql'),
  'utf8',
)

describe('contrato da migration P0 (webhook transportadora -- payload de auditoria)', () => {
  it('e transacional', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('COMMIT;')
  })

  it('depende das migrations anteriores do webhook de transportadora (guard defensivo no topo)', () => {
    expect(migration).toContain("to_regclass('public.integracao_logistica_webhook_eventos')")
    expect(migration).toContain("to_regprocedure('public.admin_obter_webhook_evento_transportadora(uuid)')")
  })

  it('adiciona request_payload/response_payload/response_http_status/respondido_em de forma idempotente', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS request_payload jsonb')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS response_payload jsonb')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS response_http_status integer')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS respondido_em timestamptz')
  })

  it('admin_obter_webhook_evento_transportadora passa a expor os 4 campos novos, alem de continuar sem Base64/token', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_obter_webhook_evento_transportadora'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.admin_obter_webhook_evento_transportadora'),
    )
    expect(funcao).toContain("'request_payload', v_evento.request_payload")
    expect(funcao).toContain("'response_payload', v_evento.response_payload")
    expect(funcao).toContain("'response_http_status', v_evento.response_http_status")
    expect(funcao).toContain("'respondido_em', v_evento.respondido_em")
    expect(funcao.toLowerCase()).not.toMatch(/imagem_base64|payload_base64|'token'/)
  })

  it('mantem o gate de Super Admin e os grants existentes (nunca abre para anon)', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_obter_webhook_evento_transportadora'),
    )
    expect(funcao).toContain('usuario_e_super_admin()')
    expect(funcao).toContain('REVOKE ALL ON FUNCTION public.admin_obter_webhook_evento_transportadora(uuid) FROM PUBLIC, anon;')
    expect(funcao).toContain('GRANT EXECUTE ON FUNCTION public.admin_obter_webhook_evento_transportadora(uuid) TO authenticated;')
  })
})
