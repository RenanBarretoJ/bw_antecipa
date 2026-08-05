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
