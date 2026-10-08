import type { UserRole } from '@/types/database'
import { requireRole } from '@/lib/auth/authorization'
import { NotificacoesPageClient } from './notificacoes-page-client'
import { parseNotificacaoFiltro } from '@/lib/notificacoes/contracts'

export async function NotificacoesPageServer({ role, basePath, filtro }: {
  role: UserRole; basePath: string; filtro?: string | string[]
}) {
  await requireRole(role)
  return <NotificacoesPageClient initialFilter={parseNotificacaoFiltro(Array.isArray(filtro) ? filtro[0] : filtro)} basePath={basePath} />
}
