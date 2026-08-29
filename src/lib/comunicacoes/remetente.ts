const NOME_REMETENTE_PADRAO = 'BETTER WITH'
const LIMITE_NOME_REMETENTE = 120
const SUFIXO_LIMITADA = /\s+(?:LTDA\.?|LIMITADA)$/iu

export function resolverNomeRemetenteGestora(value: unknown): string {
  const nomeSemControles = String(value || '')
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()

  if (!nomeSemControles) return NOME_REMETENTE_PADRAO

  const nomeComercial = nomeSemControles.replace(SUFIXO_LIMITADA, '').trim()
  return (nomeComercial || nomeSemControles).slice(0, LIMITE_NOME_REMETENTE)
}
