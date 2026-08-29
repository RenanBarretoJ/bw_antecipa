import type { ComunicacaoCategoria, GrupoComunicacao, ItemComunicacao } from './tipos'

const CRITICIDADE: Record<ComunicacaoCategoria, number> = {
  LOGISTICA_LEMBRETE: 1,
  LOGISTICA_VENCE_HOJE: 2,
  LOGISTICA_VENCIDO: 3,
  LOGISTICA_REJEITADO: 4,
  FINANCEIRO_LEMBRETE: 1,
  FINANCEIRO_VENCE_HOJE: 2,
  FINANCEIRO_VENCIDO: 3,
}
export function agruparComunicacoes(itens: ItemComunicacao[]): GrupoComunicacao[] {
  const groups = new Map<string, GrupoComunicacao>()
  for (const item of itens) {
    const emailKey = item.destinatarioEmail?.trim().toLowerCase() || `bloqueado:${item.destinatarioNome}`
    const key = [item.fundoId, item.familia, emailKey, item.etapa.dataEfetiva].join('|')
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        familia: item.familia,
        fundoId: item.fundoId,
        fundoNome: item.fundoNome,
        destinatarioNome: item.destinatarioNome,
        destinatarioEmail: item.destinatarioEmail,
        dataEfetiva: item.etapa.dataEfetiva,
        categoria: item.categoria,
        itens: [item],
      })
      continue
    }
    if (!existing.itens.some((candidate) => candidate.itemKey === item.itemKey && candidate.etapa.chave === item.etapa.chave)) {
      existing.itens.push(item)
    }
    if (CRITICIDADE[item.categoria] > CRITICIDADE[existing.categoria]) existing.categoria = item.categoria
  }
  return [...groups.values()]
}
