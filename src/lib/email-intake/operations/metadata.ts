/** Plain text for operator display. Message bodies and raw headers are never requested. */
export function safeEmailSubject(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\bBearer\s+\S+/gi, '[credencial omitida]')
    .replace(/\b(?:token|secret|senha|password)\s*[:=]\s*\S+/gi, '[credencial omitida]')
    .replace(/https?:\/\/\S+/gi, '[link omitido]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[e-mail omitido]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ omitido]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF omitido]')
    .replace(/[A-Za-z0-9_~+\/=.-]{40,}/g, '[identificador omitido]')
    .replace(/\s+/g, ' ').trim().slice(0, 240) || 'Sem assunto'
}

export function maskEmailSender(value: string | undefined): string {
  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 320) return 'Remetente não disponível'
  const [local, domain] = value.split('@')
  return `${local.slice(0, 1)}***@${domain.toLowerCase()}`.replace(/[\p{Cc}\p{Cf}]/gu, '')
}
