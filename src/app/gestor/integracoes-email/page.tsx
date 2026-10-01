import { requireGestor } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { EmailHealthPanel } from '@/components/email-intake/health-panel'

export default async function EmailIntegrationHealthPage() {
  const auth = await requireGestor(), fundo = await resolverContextoFundoGestor(auth)
  return <PageContainer className="space-y-5">
    <PageHeader title="Integração de e-mail" description={`Acompanhamento operacional · ${fundo.fundoNome}`} />
    <EmailHealthPanel fundoId={fundo.fundoId} />
  </PageContainer>
}
