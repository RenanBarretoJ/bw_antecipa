export function somenteDigitos(value: string | null | undefined) {
  return String(value ?? '').replace(/\D/g, '')
}

export function calcularDvChaveNfe(base43: string) {
  if (!/^\d{43}$/.test(base43)) return null
  let sum = 0
  let weight = 2
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(base43[index]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const candidate = 11 - (sum % 11)
  return candidate >= 10 ? 0 : candidate
}

export function validarChaveNfe55(value: string | null | undefined) {
  const key = somenteDigitos(value)
  if (!/^\d{44}$/.test(key) || key.slice(20, 22) !== '55') return false
  return calcularDvChaveNfe(key.slice(0, 43)) === Number(key[43])
}

export function identidadeDaChaveNfe(key: string) {
  if (!validarChaveNfe55(key)) return null
  return {
    cnpjEmitente: key.slice(6, 20),
    modelo: key.slice(20, 22),
    serie: key.slice(22, 25).replace(/^0+/, '') || '0',
    numero: key.slice(25, 34).replace(/^0+/, '') || '0',
  }
}
