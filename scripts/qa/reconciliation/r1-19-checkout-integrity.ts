import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

type Identity = { path: string; version: string; sha256: string }
type CanonicalIdentity = Identity & { source_kind: string }
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

// Validate representation, not SQL semantics. No trimming, BOM removal or mixed-EOL repair.
// R1.3 captured Windows checkout bytes; R1.5 pins canonical source bytes independently.
export function assertCheckoutIdentity(bytes: Buffer, legacy: Identity, canonical: CanonicalIdentity) {
  assert.equal(canonical.path, legacy.path, 'CANONICAL_PATH_MISMATCH')
  assert.equal(canonical.version, legacy.version, 'CANONICAL_VERSION_MISMATCH')
  const text = bytes.toString('utf8')
  assert(Buffer.from(text).equals(bytes), 'INVALID_UTF8_CHECKOUT')
  if (canonical.source_kind === 'NEW_FORWARD_EXACT_LF') {
    assert(!text.includes('\r'), 'FORWARD_NOT_EXACT_LF')
    assert.equal(sha256(bytes), canonical.sha256, 'FORWARD_HASH_DRIFT')
    assert.equal(sha256(bytes), legacy.sha256, 'LEGACY_FORWARD_HASH_DRIFT')
    return
  }
  assert.equal(canonical.source_kind, 'GIT_BLOB', 'UNSUPPORTED_SOURCE_KIND')
  const lf = text.replaceAll('\r\n', '\n')
  assert(!lf.includes('\r'), 'BARE_CR_CHECKOUT')
  assert(!text.includes('\r\n') || !text.replaceAll('\r\n', '').includes('\n'), 'MIXED_EOL_CHECKOUT')
  const canonicalBytes = Buffer.from(lf)
  assert.equal(sha256(canonicalBytes), canonical.sha256, 'CANONICAL_HASH_DRIFT')
  // Exact reconstruction of the old Windows representation, independently hash-checked.
  assert.equal(sha256(Buffer.from(lf.replaceAll('\n', '\r\n'))), legacy.sha256, 'LEGACY_REPRESENTATION_DRIFT')
}
