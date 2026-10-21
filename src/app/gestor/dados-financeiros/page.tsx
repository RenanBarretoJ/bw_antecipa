import { requireGestor } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { carregarHistoricoRelatorios } from '@/lib/integracoes/vortx/relatorios-contexto.server'
import { relatoriosPreviewPermitidos } from '@/lib/integracoes/vortx/relatorios-operacao'
import { obterDataCivilOperacional } from '@/lib/operacoes/data-operacional.server'
import { VortxReportRequests } from '@/components/admin/vortx-report-requests'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'

export default async function DadosFinanceirosPage({ searchParams }: {
  searchParams: Promise<{ pagina?: string }>
}) {
  const auth = await requireGestor()
  const { fundoId, fundoNome } = await resolverContextoFundoGestor(auth)
  const query = await searchParams
  const pagina = Math.min(10000, Math.max(1, Number.parseInt(query.pagina || '1', 10) || 1))
  const dados = relatoriosPreviewPermitidos(fundoId) ? await carregarHistoricoRelatorios(fundoId, pagina) : null
  return <PageContainer className="space-y-5">
    <PageHeader title="Dados Financeiros" description={`Relatórios e acompanhamento do Fundo ativo: ${fundoNome}.`} />
    {dados ? <VortxReportRequests key={fundoId} {...dados} pagina={pagina} hoje={obterDataCivilOperacional()} />
      : <div role="status" className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">A consulta operacional de relatórios ainda não está habilitada para este Fundo neste ambiente.</div>}
  </PageContainer>
}
