import Link from 'next/link'
import { notFound } from 'next/navigation'
import { VortxReportRequests } from '@/components/admin/vortx-report-requests'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { relatoriosPreviewPermitidos } from '@/lib/integracoes/vortx/relatorios-operacao'
import { carregarHistoricoRelatorios } from '@/lib/integracoes/vortx/relatorios-contexto.server'
import { obterDataCivilOperacional } from '@/lib/operacoes/data-operacional.server'

export const runtime = 'nodejs'
export const maxDuration = 60

export default async function RelatoriosVortxPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ pagina?: string }>
}) {
  const { id } = await params
  if (!relatoriosPreviewPermitidos(id)) notFound()
  const query = await searchParams
  const pagina = Math.min(10000, Math.max(1, Number.parseInt(query.pagina || '1', 10) || 1))
  const { contexto, historico } = await carregarHistoricoRelatorios(id, pagina)
  return <PageContainer className="space-y-5">
    <Link href={`/admin/fundos/${id}?tab=integracoes`} className="text-sm text-primary underline">Voltar às integrações do Fundo</Link>
    <PageHeader eyebrow="Integrações · Preview" title="Relatórios Vórtx" description="Solicite a consulta, confira o protocolo e acompanhe o pedido sem movimentar a carteira." />
    <VortxReportRequests contexto={contexto} historico={historico} pagina={pagina} hoje={obterDataCivilOperacional()} />
  </PageContainer>
}
