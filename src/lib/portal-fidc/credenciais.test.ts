import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  criptografarPortalFidcValor,
  descriptografarPortalFidcValor,
  diagnosticarKeyringPortalFidc,
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

describe('diagnosticarKeyringPortalFidc', () => {
  it('reporta source NONE e tudo invalido quando nenhuma env esta configurada', () => {
    const diagnostico = diagnosticarKeyringPortalFidc()
    expect(diagnostico).toEqual({
      keyringConfigurado: false,
      activeVersion: 'v1',
      activeVersionFound: false,
      keyLengthValid: false,
      source: 'NONE',
    })
  })

  it('reporta source KEYS_JSON, versao ativa encontrada e chave de 32 bytes valida', () => {
    configurarChave('k2026')
    const diagnostico = diagnosticarKeyringPortalFidc()
    expect(diagnostico).toEqual({
      keyringConfigurado: true,
      activeVersion: 'k2026',
      activeVersionFound: true,
      keyLengthValid: true,
      source: 'KEYS_JSON',
    })
  })

  it('detecta quando a versao ativa aponta para uma chave que nao existe no keyring', () => {
    process.env.PORTAL_FIDC_CREDENTIAL_KEYS_JSON = JSON.stringify({ k1: randomBytes(32).toString('base64') })
    process.env.PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION = 'k2_inexistente'

    const diagnostico = diagnosticarKeyringPortalFidc()

    expect(diagnostico.source).toBe('KEYS_JSON')
    expect(diagnostico.keyringConfigurado).toBe(true)
    expect(diagnostico.activeVersion).toBe('k2_inexistente')
    expect(diagnostico.activeVersionFound).toBe(false)
    expect(diagnostico.keyLengthValid).toBe(false)
  })

  it('detecta chave com tamanho invalido (nao 32 bytes) mesmo com versao ativa encontrada', () => {
    process.env.PORTAL_FIDC_CREDENTIAL_KEYS_JSON = JSON.stringify({ k1: randomBytes(16).toString('base64') })
    process.env.PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION = 'k1'

    const diagnostico = diagnosticarKeyringPortalFidc()

    expect(diagnostico.activeVersionFound).toBe(true)
    expect(diagnostico.keyLengthValid).toBe(false)
  })

  it('reporta source LEGACY_FALLBACK quando so a chave unica antiga esta configurada', () => {
    process.env.PORTAL_FIDC_CREDENTIAL_MASTER_KEY_B64 = randomBytes(32).toString('base64')

    const diagnostico = diagnosticarKeyringPortalFidc()

    expect(diagnostico.source).toBe('LEGACY_FALLBACK')
    expect(diagnostico.keyringConfigurado).toBe(true)
    expect(diagnostico.activeVersion).toBe('v1')
    expect(diagnostico.activeVersionFound).toBe(true)
    expect(diagnostico.keyLengthValid).toBe(true)
  })

  it('nao lanca excecao e reporta keyring vazio quando PORTAL_FIDC_CREDENTIAL_KEYS_JSON e um JSON invalido', () => {
    process.env.PORTAL_FIDC_CREDENTIAL_KEYS_JSON = '{isso nao e json valido'

    const diagnostico = diagnosticarKeyringPortalFidc()

    expect(diagnostico.source).toBe('KEYS_JSON')
    expect(diagnostico.keyringConfigurado).toBe(false)
    expect(diagnostico.activeVersionFound).toBe(false)
    expect(diagnostico.keyLengthValid).toBe(false)
  })

  it('nunca inclui a chave, o JSON do keyring ou qualquer segredo no resultado', () => {
    const key = configurarChave('k2026')
    const diagnostico = diagnosticarKeyringPortalFidc()
    const serialized = JSON.stringify(diagnostico)
    expect(serialized).not.toContain(key)
    expect(Object.keys(diagnostico).sort()).toEqual(
      ['activeVersion', 'activeVersionFound', 'keyLengthValid', 'keyringConfigurado', 'source'].sort(),
    )
  })
})
