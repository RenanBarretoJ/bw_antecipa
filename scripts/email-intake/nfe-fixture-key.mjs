import assert from 'node:assert/strict'

/** Synthetic fixture identity with a real NF-e check digit; never a fiscal parser. */
export function nfeFixtureKey({ issuer, number, issued }) {
  const prefix = ['35', issued.slice(2, 7).replace('-', ''), issuer, '55', '001',
    String(number).padStart(9, '0'), '1', '12345678'].join('')
  assert.match(prefix, /^\d{43}$/)
  let sum = 0, weight = 2
  for (let i = 42; i >= 0; i--) {
    sum += Number(prefix[i]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  return prefix + (sum % 11 < 2 ? 0 : 11 - sum % 11)
}
