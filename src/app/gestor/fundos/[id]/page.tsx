import { redirect } from 'next/navigation'

export default async function FundoGestorLegacyRedirect({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab
  if (tab === 'templates') redirect('/gestor/configuracoes?tab=templates')
  if (tab === 'comunicacoes') redirect('/gestor/configuracoes?tab=comunicacoes')
  redirect('/gestor/configuracoes?tab=politicas')
}
