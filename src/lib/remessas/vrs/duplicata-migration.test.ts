import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'

const path = 'supabase/migrations/20261022211047_vrs_duplicata_parcela_keys.sql'
const migration = readFileSync(path, 'utf8')
it('altera somente o formato das duas chaves, preservando contratos legados', () => {
  expect(migration).toContain("'^[A-Za-z0-9._-]{1,100}$'")
  expect(migration).toContain("'^[0-9]+/[1-9][0-9]{0,2}$'")
  expect(migration).toContain("'^[0-9]+/[1-9][0-9]{0,2}-1$'")
  expect(migration.match(/DROP CONSTRAINT/g)).toHaveLength(2)
  expect(migration).not.toMatch(/\b(?:GRANT|REVOKE|POLICY|DISABLE|INSERT|DELETE|UPDATE|TRUNCATE)\b/i)
  expect(migration).not.toContain('remessa_operacional_chaves_identidade_unique')
})
it('preserva os bytes da migration historica e do golden XLSX', () => {
  const historical = 'supabase/migrations/20260826211301_p4_remessas_operacionais_adapter.sql'
  // Pin the reviewed historical bytes, normalizing CRLF only. Native Docker QA
  // intentionally receives source without .git; do not depend on repository metadata.
  expect(createHash('sha256').update(readFileSync(historical, 'utf8').replaceAll('\r\n', '\n')).digest('hex'))
    .toBe('17951a8db672a314fe917ef7702e332a8008dbfb4b855e44791734d75e768154')
  expect(createHash('sha256').update(readFileSync('src/lib/remessas/vrs/__fixtures__/inclusao_modelo.xlsx')).digest('hex'))
    .toBe('a758b9032c94fc3dfc2c9560d3325c55ec9101d2b03c8de71a5149e743d5d813')
})
