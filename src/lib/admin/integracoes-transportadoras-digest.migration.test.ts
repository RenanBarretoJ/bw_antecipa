import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260824200000_corrigir_digest_integracao_transportadora.sql'),
  'utf8',
)

function section(start: string, end: string) {
  return migration.slice(migration.indexOf(start), migration.indexOf(end))
}

describe('correcao do SHA-256 das integracoes de transportadoras', () => {
  it('corrige somente as RPCs que emitem tokens sem ampliar o search_path', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.admin_criar_integracao_transportadora')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.admin_rotacionar_token_integracao_transportadora')
    expect(migration.match(/SET search_path = public/g)).toHaveLength(2)
    expect(migration).not.toContain('CREATE EXTENSION')
  })

  it('qualifica pgcrypto e fixa a assinatura bytea/text em todos os hashes', () => {
    const criar = section(
      'CREATE OR REPLACE FUNCTION public.admin_criar_integracao_transportadora',
      'CREATE OR REPLACE FUNCTION public.admin_rotacionar_token_integracao_transportadora',
    )
    const rotacionar = section(
      'CREATE OR REPLACE FUNCTION public.admin_rotacionar_token_integracao_transportadora',
      'REVOKE ALL ON FUNCTION public.admin_criar_integracao_transportadora',
    )

    for (const rpc of [criar, rotacionar]) {
      expect(rpc.match(/extensions\.digest\(/g)).toHaveLength(2)
      expect(rpc.match(/pg_catalog\.convert_to\(/g)).toHaveLength(2)
      expect(rpc).not.toMatch(/(?<!extensions\.)\bdigest\s*\(/)
    }
  })

  it('mantem SHA-256 hexadecimal de UTF-8 compativel com o resolver Bearer', () => {
    expect(createHash('sha256').update('abc', 'utf8').digest('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(migration).toContain("pg_catalog.convert_to(v_token, 'UTF8'::name)")
    expect(migration).toContain("'sha256'::text")
    expect(migration).toContain("'hex'::text")
  })

  it('preserva autorizacao e grants restritos das RPCs administrativas', () => {
    expect(migration.match(/private\.usuario_e_super_admin\(\)/g)).toHaveLength(2)
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.admin_criar_integracao_transportadora(uuid, text, text, text) FROM PUBLIC, anon;',
    )
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.admin_rotacionar_token_integracao_transportadora(uuid) FROM PUBLIC, anon;',
    )
    expect(migration.match(/TO authenticated;/g)).toHaveLength(2)
  })
})
