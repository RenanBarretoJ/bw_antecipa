import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  criptografarPortalFidcValor,
  descriptografarPortalFidcValor,
  getPortalFidcActiveKeyVersion,
} from '@/lib/portal-fidc/credenciais'

const ENV_KEYS = [
  'PORTAL_FIDC_CREDENTIAL_KEYS_JSON',
  'PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION',
  'PORTAL_FIDC_CREDENTIAL_MASTER_KEY_B64',
  'PORTAL_FIDC_CREDENTIAL_MASTER_KEY',
]

function configurarChave(version = 'k1') {
  const key = randomBytes(32).toString('base64')
  process.env.PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION = version
  process.env.PORTAL_FIDC_CREDENTIAL_KEYS_JSON = JSON.stringify({ [version]: key })
  return key
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('Portal FIDC encrypted credentials', () => {
  it('criptografa e descriptografa somente server-side com chave versionada', () => {
    configurarChave('k2026')

    const encrypted = criptografarPortalFidcValor('senha-super-secreta')

    expect(encrypted.chaveVersao).toBe('k2026')
    expect(encrypted.ciphertext).not.toContain('senha-super-secreta')
    expect(encrypted.ciphertext).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/)
    expect(descriptografarPortalFidcValor(encrypted.ciphertext, encrypted.chaveVersao)).toBe('senha-super-secreta')
  })

  it('usa nonce unico para valores iguais', () => {
    configurarChave()

    const first = criptografarPortalFidcValor('mesmo-valor')
    const second = criptografarPortalFidcValor('mesmo-valor')

    expect(first.ciphertext).not.toBe(second.ciphertext)
    expect(descriptografarPortalFidcValor(first.ciphertext, first.chaveVersao)).toBe('mesmo-valor')
    expect(descriptografarPortalFidcValor(second.ciphertext, second.chaveVersao)).toBe('mesmo-valor')
  })

  it('falha quando a integridade do ciphertext e alterada', () => {
    configurarChave()
    const encrypted = criptografarPortalFidcValor('segredo')
    const parts = encrypted.ciphertext.split(':')
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`

    expect(() => descriptografarPortalFidcValor(parts.join(':'), encrypted.chaveVersao)).toThrow()
  })

  it('falha quando a chave de criptografia nao esta configurada', () => {
    expect(getPortalFidcActiveKeyVersion()).toBe('v1')
    expect(() => criptografarPortalFidcValor('segredo')).toThrow(/chave de criptografia/i)
  })
})
