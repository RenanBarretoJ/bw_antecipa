import { notFound, redirect } from 'next/navigation'
import { relatoriosPreviewPermitidos } from '@/lib/integracoes/vortx/relatorios-operacao'

export const runtime = 'nodejs'
export const maxDuration = 60

export default async function RelatoriosVortxPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ pagina?: string }>
}) {
  const { id } = await params
  if (!relatoriosPreviewPermitidos(id)) notFound()
  const query = await searchParams
  const pagina = Math.min(10000, Math.max(1, Number.parseInt(query.pagina || '1', 10) || 1))
  redirect(`/admin/fundos/${id}?tab=dados-financeiros&pagina=${pagina}`)
}
