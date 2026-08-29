import { NotificacoesPageServer } from '@/components/notificacoes/notificacoes-page-server'

export default async function NotificacoesPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string | string[] }>
}) {
  const { filtro } = await searchParams
  return <NotificacoesPageServer role="consultor" basePath="/consultor/notificacoes" filtro={filtro} />
}
