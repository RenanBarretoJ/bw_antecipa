import 'server-only'

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function obterDataCivilOperacional(instant = new Date()): string {
  return formatter.format(instant)
}

export function dataCivilIsoValida(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value
}

export function resolverDataCivilOperacional(value: string | null | undefined, instant = new Date()): string {
  const requested = value?.trim() || ''
  return dataCivilIsoValida(requested) ? requested : obterDataCivilOperacional(instant)
}
