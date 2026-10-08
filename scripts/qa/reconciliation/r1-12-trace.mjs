import assert from 'node:assert/strict'
import { Client } from 'pg'
import { hash } from './r1-4-restorer.mjs'
import { assertR110Connection } from './r1-10-stack-guard.mjs'

export function identityShape(type, material) {
  let tuple
  try { const value = JSON.parse(material); if (Array.isArray(value)) tuple = value } catch { /* Not municipal JSON. */ }
  return { documentType: type, fiscalType: type === 'NFSE' ? (tuple ? 'MUNICIPAL' : 'NATIONAL') : type,
    accessKeyPresent: material != null && !tuple, length: material?.length ?? 0,
    characterClass: typeof material === 'string' && /^[0-9]+$/.test(material) ? 'DIGITS' : tuple ? 'JSON_TUPLE' : 'OTHER',
    allSameDigit: typeof material === 'string' && /^([0-9])\1+$/.test(material), sha256: material == null ? null : hash(material),
    municipalFields: { issuer: Boolean(tuple?.[1]), authority: Boolean(tuple?.[2]), invoiceNumber: Boolean(tuple?.[3]) },
    issuerIdentity: tuple?.[1] ?? null, issuingAuthority: tuple?.[2] ?? null, invoiceNumber: tuple?.[3] ?? null }
}

// Installed only by a local diagnostic runner, after ownership verification.
// Forward the original SQL and arguments unchanged; never log tokens or raw keys.
export function installReserveTrace(connection, entries, persist) {
  assertR110Connection(connection, 'operational')
  const original = Client.prototype.query
  Client.prototype.query = function (...args) {
    const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text
    if (!/^select public\.fiscal_intake_reserve\(/i.test(sql ?? '')) return original.apply(this, args)
    assert.equal(this.connectionParameters.host, connection.host)
    assert.equal(this.connectionParameters.port, connection.port)
    assert.equal(this.connectionParameters.database, connection.database)
    const values = args[1], actor = values[0]
    const caller = new Error().stack.split('\n').find(line => /scripts[\/]email-intake/.test(line))?.trim() ?? 'DIRECTED_CONTROL'
    const trace = { sequence: entries.length + 1, scenario: caller.includes('lifecycle-db') ? 'OFFICIAL_EMAIL_REVIEW_SINGLE_RECEIPT' : 'OPERATIONAL_RESERVATION',
      caller, ...identityShape(values[4], values[5]), actorMode: actor.type,
      fundId: values[1], cedenteFundoId: values[2], establishmentId: values[3],
      issuerContext: '98100000000168 (synthetic setup; not inferred from national key)',
      payloadShape: { actorFields: Object.keys(actor).sort(), argumentCount: values.length, fileHashLength: values[6]?.length }, result: 'PENDING' }
    entries.push(trace)
    return (async () => {
      await persist()
      try { const result = await original.apply(this, args); trace.result = result.rows[0]?.result?.status ?? 'SUCCESS'; return result }
      catch (e) { trace.result = 'ERROR'; trace.error = { code: e.code, message: e.message, where: e.where }; throw e }
      finally { await persist() }
    })()
  }
  return () => { Client.prototype.query = original }
}
