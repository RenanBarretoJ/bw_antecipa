import { createHmac, randomBytes } from 'node:crypto'

export const PERF9A_USERS = [
  { key: 'gestor_a', role: 'gestor', name: 'PERF9A_Gestor Fundo A' },
  { key: 'gestor_b', role: 'gestor', name: 'PERF9A_Gestor Fundo B' },
  { key: 'gestor_multi', role: 'gestor', name: 'PERF9A_Gestor Multi' },
  { key: 'cedente_a', role: 'cedente', name: 'PERF9A_Cedente A' },
  { key: 'cedente_b', role: 'cedente', name: 'PERF9A_Cedente B' },
  { key: 'cedente_multi', role: 'cedente', name: 'PERF9A_Cedente Multi' },
  { key: 'cedente_sem_escrow', role: 'cedente', name: 'PERF9A_Cedente sem Escrow' },
  { key: 'cedente_com_escrow', role: 'cedente', name: 'PERF9A_Cedente com Escrow' },
  { key: 'consultor_a', role: 'consultor', name: 'PERF9A_Consultor A' },
  { key: 'consultor_b', role: 'consultor', name: 'PERF9A_Consultor B' },
  { key: 'sacado_a', role: 'sacado', name: 'PERF9A_Sacado A' },
  { key: 'sacado_b', role: 'sacado', name: 'PERF9A_Sacado B' },
  { key: 'sacado_inativo', role: 'sacado', name: 'PERF9A_Sacado Inativo' },
  { key: 'sem_perfil', role: 'gestor', name: 'PERF9A_Usuario sem Perfil' },
  { key: 'usuario_inativo', role: 'cedente', name: 'PERF9A_Usuario Inativo' },
  { key: 'sem_fundo', role: 'gestor', name: 'PERF9A_Gestor sem Fundo' },
  { key: 'role_mismatch', role: 'consultor', name: 'PERF9A_Perfil Divergente' },
  { key: 'bulk_cedente_a', role: 'cedente', name: 'PERF9A_Carga Cedentes A' },
  { key: 'bulk_cedente_b', role: 'cedente', name: 'PERF9A_Carga Cedentes B' },
  { key: 'bulk_onboarding', role: 'cedente', name: 'PERF9A_Carga Onboarding' },
]

export function generatePassword() {
  return `${randomBytes(24).toString('base64url')}Aa1!`
}

export function generateValidCnpj(sequence) {
  const base = String(100000000000 + Number(sequence)).padStart(12, '0').slice(-12)
  const first = calculateCnpjDigit(base)
  const second = calculateCnpjDigit(`${base}${first}`)
  return `${base}${first}${second}`
}

export function formatCnpj(value) {
  const digits = String(value).replace(/\D/g, '')
  if (digits.length !== 14) throw new Error('CNPJ precisa ter 14 digitos.')
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

export function generateTotp(secret, now = Date.now()) {
  const key = decodeBase32(secret)
  const counter = Math.floor(now / 30_000)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  )
  return String(binary % 1_000_000).padStart(6, '0')
}

function calculateCnpjDigit(value) {
  const weights = value.length === 12
    ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const sum = value.split('').reduce((total, digit, index) => total + Number(digit) * weights[index], 0)
  const remainder = sum % 11
  return remainder < 2 ? 0 : 11 - remainder
}

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const normalized = value.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '')
  let bits = ''

  for (const character of normalized) {
    const index = alphabet.indexOf(character)
    if (index < 0) throw new Error('Secret TOTP em Base32 invalido.')
    bits += index.toString(2).padStart(5, '0')
  }

  const bytes = []
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2))
  }
  return Buffer.from(bytes)
}
