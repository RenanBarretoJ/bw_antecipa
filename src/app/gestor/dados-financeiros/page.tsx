import { requireGestor } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { carregarHistoricoRelatorios } from '@/lib/integracoes/vortx/relatorios-contexto.server'
import { relatoriosPermitidos } from '@/lib/integracoes/vortx/relatorios-runtime'
import { obterDataCivilOperacional } from '@/lib/operacoes/data-operacional.server'
import { VortxReportRequests } from '@/components/admin/vortx-report-requests'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { lerFiltrosBases } from '@/lib/integracoes/vortx/central-bases'

export default async function DadosFinanceirosPage({ searchParams }: {
  searchParams: Promise<{ pagina?: string; tipo?: string; origem?: string; estado?: string; referencia?: string }>
}) {
  const auth = await requireGestor()
  const { fundoId, fundoNome } = await resolverContextoFundoGestor(auth)
  const query = await searchParams
  const pagina = Math.min(10000, Math.max(1, Number.parseInt(query.pagina || '1', 10) || 1))
  const filtros = lerFiltrosBases(query)
  const dados = relatoriosPermitidos(fundoId) ? await carregarHistoricoRelatorios(fundoId, pagina, filtros) : null
  return <PageContainer className="space-y-5">
    {!dados && <PageHeader title="Central de Bases" description={`Bases e acompanhamento do Fundo ativo: ${fundoNome}.`} />}
    {dados ? <VortxReportRequests key={fundoId} {...dados} pagina={pagina} filtros={filtros} historicoHref="/gestor/dados-financeiros" hoje={obterDataCivilOperacional()} headingLevel={1} />
      : <div role="status" className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">A consulta operacional de relatórios ainda não está habilitada para este Fundo neste ambiente.</div>}
  </PageContainer>
}
