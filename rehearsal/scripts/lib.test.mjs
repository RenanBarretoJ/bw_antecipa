import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PRODUCTION_PROJECT_REF,
  assertLocalTarget,
  assertProductionReadOnlyConfig,
  extractProjectRef,
  sanitizeText,
  sqlLiteral,
} from './lib.mjs'
import { buildSafeAuthSql, buildStorageMetadataSql } from './export-production.mjs'

test('extrai project ref de conexao direta e pooler', () => {
  assert.equal(extractProjectRef(`postgresql://postgres:x@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`), PRODUCTION_PROJECT_REF)
  assert.equal(extractProjectRef(`postgresql://postgres.${PRODUCTION_PROJECT_REF}:x@aws-0-us-east-1.pooler.supabase.com:5432/postgres`), PRODUCTION_PROJECT_REF)
})

test('exportacao exige ref e confirmacao exatos de producao', () => {
  const config = assertProductionReadOnlyConfig({
    REHEARSAL_PRODUCTION_DB_URL: `postgresql://postgres.${PRODUCTION_PROJECT_REF}:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    REHEARSAL_PRODUCTION_PROJECT_REF: PRODUCTION_PROJECT_REF,
    REHEARSAL_CONFIRM_EXPORT: `EXPORTAR_SOMENTE_LEITURA_${PRODUCTION_PROJECT_REF}`,
  })
  assert.equal(config.projectRef, PRODUCTION_PROJECT_REF)
})

test('exportacao rejeita homologacao e confirmacao incorreta', () => {
  assert.throws(() => assertProductionReadOnlyConfig({
    REHEARSAL_PRODUCTION_DB_URL: 'postgresql://postgres.fhgkmggthxikfpogrvaa:x@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
    REHEARSAL_PRODUCTION_PROJECT_REF: PRODUCTION_PROJECT_REF,
    REHEARSAL_CONFIRM_EXPORT: 'incorreta',
  }))
})

test('operacao destrutiva aceita somente porta local dedicada', () => {
  assert.doesNotThrow(() => assertLocalTarget({ host: '127.0.0.1', port: 55322 }))
  assert.throws(() => assertLocalTarget({ host: `db.${PRODUCTION_PROJECT_REF}.supabase.co`, port: 5432 }))
  assert.throws(() => assertLocalTarget({ host: '127.0.0.1', port: 54322 }))
})

test('sanitiza credenciais e literais SQL escapam aspas', () => {
  assert.equal(sanitizeText('postgresql://postgres:segredo@db.exemplo.supabase.co/postgres'), 'postgresql://postgres:***@db.exemplo.supabase.co/postgres')
  assert.equal(sqlLiteral("d'agua"), "'d''agua'")
  assert.equal(sqlLiteral({ role: 'gestor' }, 'jsonb'), `'${JSON.stringify({ role: 'gestor' })}'::jsonb`)
  assert.equal(sqlLiteral(['application/pdf', 'text/xml'], 'text_array'), "array['application/pdf', 'text/xml']::text[]")
  assert.equal(sqlLiteral(new Date('2026-08-27T12:00:00Z'), 'timestamptz'), "'2026-08-27T12:00:00.000Z'::timestamptz")
})

test('Auth sanitizado nunca inclui senha ou token de origem', () => {
  const sql = buildSafeAuthSql([{
    instance_id: '00000000-0000-0000-0000-000000000000',
    id: '11111111-1111-1111-1111-111111111111',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'usuario@example.test',
    email_confirmed_at: null,
    raw_app_meta_data: { provider: 'email' },
    raw_user_meta_data: {},
    is_super_admin: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    phone: null,
    phone_confirmed_at: null,
    is_sso_user: false,
    deleted_at: null,
    is_anonymous: false,
    encrypted_password: 'NAO_PODE_APARECER', // dummy marker de teste
    recovery_token: 'NAO_PODE_APARECER', // dummy marker de teste
  }], [])
  assert.doesNotMatch(sql, /NAO_PODE_APARECER/u)
  assert.match(sql, /encrypted_password[\s\S]*null/u)
})

test('Storage usa somente colunas compativeis e nao restaura marcadores novos', () => {
  const sql = buildStorageMetadataSql([], [])
  assert.doesNotMatch(sql, /versioning_status|archived_at|is_delete_marker|is_versioned/u)
  assert.match(sql, /begin;[\s\S]*commit;/u)
})
