import type { UserRole } from '@/types/database'
import { NotificacoesPageClient } from './notificacoes-page-client'
import { carregarNotificacoesUsuario } from '@/lib/notificacoes/listagem.server'
import { parseNotificacaoFiltro } from '@/lib/notificacoes/contracts'

export async function NotificacoesPageServer({
  role,
  basePath,
  filtro,
}: {
  role: UserRole
  basePath: string
  filtro?: string | string[]
}) {
  const parsedFilter = parseNotificacaoFiltro(Array.isArray(filtro) ? filtro[0] : filtro)
  const page = await carregarNotificacoesUsuario({
    filtro: parsedFilter,
    limit: 20,
    roleEsperada: role,
    incluirContadores: true,
  })

  return (
    <NotificacoesPageClient
      key={`${role}:${parsedFilter}`}
      initialPage={page}
      initialFilter={parsedFilter}
      userId={page.userId}
      basePath={basePath}
    />
  )
}
