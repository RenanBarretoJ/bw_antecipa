export function formatCnpj(cnpj: string) {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14) return cnpj
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

export function shortName(value: string | null | undefined, max = 34) {
  const text = (value || '').trim()
  if (!text) return 'Nao informado'
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}
