import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const CIPHER_VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

export type PortalFidcCiphertext = {
  ciphertext: string
  chaveVersao: string
}

function decodeBase64Url(value: string) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function encodeBase64Url(value: Buffer) {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeKey(raw: string) {
  const trimmed = raw.trim()
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex')
  const decoded = Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (decoded.length === KEY_BYTES) return decoded
  throw new Error('Chave Portal FIDC invalida. Use chave de 32 bytes em base64/base64url ou 64 caracteres hex.')
}

function keyringFromEnv(): Record<string, string> {
  const json = process.env.PORTAL_FIDC_CREDENTIAL_KEYS_JSON
  if (json) {
    const parsed = JSON.parse(json) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>
  }

  const fallback = process.env.PORTAL_FIDC_CREDENTIAL_MASTER_KEY_B64
    || process.env.PORTAL_FIDC_CREDENTIAL_MASTER_KEY
  if (!fallback) return {}
  return { [process.env.PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION || 'v1']: fallback }
}

export function getPortalFidcActiveKeyVersion() {
  const configured = process.env.PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION
  if (configured?.trim()) return configured.trim()
  const keys = Object.keys(keyringFromEnv())
  return keys[0] || 'v1'
}

export function getPortalFidcEncryptionKey(chaveVersao = getPortalFidcActiveKeyVersion()) {
  const keys = keyringFromEnv()
  const raw = keys[chaveVersao]
  if (!raw) throw new Error(`Chave de criptografia Portal FIDC nao configurada para a versao ${chaveVersao}.`)
  return decodeKey(raw)
}

export function criptografarPortalFidcValor(valor: string): PortalFidcCiphertext {
  const chaveVersao = getPortalFidcActiveKeyVersion()
  const key = getPortalFidcEncryptionKey(chaveVersao)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(valor, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    chaveVersao,
    ciphertext: [
      CIPHER_VERSION,
      encodeBase64Url(iv),
      encodeBase64Url(tag),
      encodeBase64Url(encrypted),
    ].join(':'),
  }
}

export function descriptografarPortalFidcValor(ciphertext: string, chaveVersao: string) {
  const [version, ivRaw, tagRaw, encryptedRaw] = ciphertext.split(':')
  if (version !== CIPHER_VERSION || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error('Ciphertext Portal FIDC invalido.')
  }

  const iv = decodeBase64Url(ivRaw)
  const tag = decodeBase64Url(tagRaw)
  const encrypted = decodeBase64Url(encryptedRaw)
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Ciphertext Portal FIDC com metadados invalidos.')
  }

  const key = getPortalFidcEncryptionKey(chaveVersao)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
