import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { localHistoryEnvelope, selection } from './s2-2s-local-history-envelope.mjs'

const args = item => ({ version: item.version, source: readFileSync(`supabase/migrations/${item.version}_${item.name}.sql`, 'utf8'), database: 'r42_unit', actor: 'r42-local-unit' })
for (const item of selection) {
  test(`exact original source stored atomically before COMMIT ${item.version}`, () => {
    const input = args(item), result = localHistoryEnvelope(input)
    assert.ok(result.payload.includes(`ARRAY[$r42_original_source$${input.source}$r42_original_source$]`))
    assert.match(result.payload, /\nCOMMIT;\s*$/)
    assert.ok(result.payload.indexOf('INSERT INTO supabase_migrations') < result.payload.lastIndexOf('COMMIT;'))
    assert.equal(result.sqlGo, false)
    assert.notEqual(result.transportSha256, result.originalRawSha256)
    const registrationTail = result.payload.slice(result.payload.lastIndexOf('$r42_original_source$]::text[],'))
    assert.ok(!/ON CONFLICT|migration repair|DISABLE ROW LEVEL SECURITY/.test(registrationTail), 'HISTORY_WRITER_MUST_NOT_UPSERT_OR_REPAIR')
  })
  test(`CRLF accepted; whitespace or SQL tampering rejected ${item.version}`, () => {
    const input = args(item)
    assert.equal(localHistoryEnvelope({ ...input, source: input.source.replace(/\r?\n/g, '\r\n') }).originalCanonicalLfSha256, item.sha256)
    assert.throws(() => localHistoryEnvelope({ ...input, source: input.source + '\n' }), /SOURCE_HASH/)
    assert.throws(() => localHistoryEnvelope({ ...input, source: input.source.replace('BEGIN;', 'BEGIN; SELECT 1;') }), /SOURCE_HASH/)
  })
}
for (const database of ['postgres', 'r41_qa', 'r42_bad;SELECT 1', 'r42_../remote', 'r42_']) test(`refuse database ${database}`, () => {
  assert.throws(() => localHistoryEnvelope({ ...args(selection[0]), database }), /LOCAL_DATABASE/)
})
for (const version of ['20261028140420','20261028173558','20261026212352','20261028195850;']) test(`refuse excluded or foreign version ${version}`, () => {
  assert.throws(() => localHistoryEnvelope({ ...args(selection[0]), version }), /ALLOWLIST/)
})
test('actor cannot be an email, credential or SQL fragment', () => {
  for (const actor of ['admin@example.com', "r42-local-x';", 'postgres']) assert.throws(() => localHistoryEnvelope({ ...args(selection[0]), actor }), /SYNTHETIC/)
})
test('predecessor binding, mutual exclusion and OFF are mandatory guards', () => {
  const { payload } = localHistoryEnvelope(args(selection[1]))
  for (const required of ['PREDECESSOR_HISTORY_HASH_REQUIRED','SELECTIVE_APPLICATION_BUSY','ALREADY_RECORDED_STOP_NO_REPLAY','EXCLUDED_PILOT_HISTORY_PRESENT','PROVIDER_OFF_REQUIRED']) assert.ok(payload.includes(required))
})
