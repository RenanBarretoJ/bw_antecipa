import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assertCheckoutIdentity } from '../../../scripts/qa/reconciliation/r1-19-checkout-integrity'
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const text = 'SELECT 1;\nSELECT 2;\n'
const base = { path: 'supabase/migrations/123_fixture.sql', version: '123' }
const canonical = { ...base, source_kind: 'GIT_BLOB', sha256: hash(text) }
const legacy = { ...base, sha256: hash(text.replaceAll('\n', '\r\n')) }
describe('explicit checkout representation integrity', () => {
  it.each([text, text.replaceAll('\n', '\r\n')])('accepts exact LF/CRLF representation %#', input => {
    expect(() => assertCheckoutIdentity(Buffer.from(input), legacy, canonical)).not.toThrow()
  })
  it.each([text.replace('1', '9'), text + ' ', '\uFEFF' + text, text.replace('\n', '\r\n'), text.replace('\n', '\r')])('rejects content/BOM/mixed/bare-CR drift %#', input => {
    expect(() => assertCheckoutIdentity(Buffer.from(input), legacy, canonical)).toThrow()
  })
  it('rejects wrong source path, version, canonical hash and legacy hash', () => {
    for (const changed of [{ path: 'wrong' }, { version: '999' }, { sha256: '0'.repeat(64) }, { source_kind: 'unknown' }]) {
      expect(() => assertCheckoutIdentity(Buffer.from(text), legacy, { ...canonical, ...changed })).toThrow()
    }
    expect(() => assertCheckoutIdentity(Buffer.from(text), { ...legacy, sha256: '0'.repeat(64) }, canonical)).toThrow()
  })
  it('rejects invalid UTF8', () => {
    expect(() => assertCheckoutIdentity(Buffer.from([0xff]), legacy, canonical)).toThrow('INVALID_UTF8_CHECKOUT')
  })
  it('requires exact LF bytes for new forwards', () => {
    const forward = { ...canonical, source_kind: 'NEW_FORWARD_EXACT_LF' }
    expect(() => assertCheckoutIdentity(Buffer.from(text), { ...legacy, sha256: hash(text) }, forward)).not.toThrow()
    expect(() => assertCheckoutIdentity(Buffer.from(text.replaceAll('\n', '\r\n')), legacy, forward)).toThrow('FORWARD_NOT_EXACT_LF')
  })
})
