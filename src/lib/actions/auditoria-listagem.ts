'use server'

import {
  carregarAuditoria,
  carregarDetalheAuditoria as carregarDetalhe,
} from '@/lib/auditoria/listagem.server'
import type { AuditoriaFiltros } from '@/lib/auditoria/contracts'

export async function carregarMaisAuditoria(input: AuditoriaFiltros & { cursor: string }) {
  return carregarAuditoria({ ...input, cursor: input.cursor, limit: 20 })
}
export async function carregarDetalheAuditoria(eventoId: string) {
  return carregarDetalhe(eventoId)
}
