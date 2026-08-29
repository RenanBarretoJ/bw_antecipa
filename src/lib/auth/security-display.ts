export function formatarTempoRestanteSessaoMfa(serverNow: string, expiraEm: string | null) {
  if (!expiraEm) return 'Nao disponivel'

  const agora = Date.parse(serverNow)
  const expiracao = Date.parse(expiraEm)
  if (!Number.isFinite(agora) || !Number.isFinite(expiracao)) return 'Nao disponivel'

  const minutosRestantes = Math.max(0, Math.ceil((expiracao - agora) / 60_000))
  if (minutosRestantes === 0) return 'Expirada'

  const horas = Math.floor(minutosRestantes / 60)
  const minutos = minutosRestantes % 60
  if (horas === 0) return `${minutos}min`
  return `${horas}h ${String(minutos).padStart(2, '0')}min`
}

export function formatarDataSeguranca(value: string | null | undefined) {
  if (!value) return 'Nao informado'
  const data = new Date(value)
  if (Number.isNaN(data.getTime())) return 'Nao informado'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(data)
}
