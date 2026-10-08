import { requireGestor } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { Suspense } from 'react'
import { EmailOperationsPage } from '@/components/email-intake/operations-page'
import type { EmailSearchParams } from '@/lib/email-intake/operations/navigation'

export default async function EmailIntegrationHealthPage({ searchParams }: { searchParams: Promise<EmailSearchParams> }) {
  const auth = await requireGestor(), fundo = await resolverContextoFundoGestor(auth)
  const params = await searchParams
  return <PageContainer className="space-y-5">
    <PageHeader title="Integrações de e-mail" eyebrow="Recebimento automático" description={`Conecte uma caixa do Outlook e acompanhe os documentos fiscais recebidos · ${fundo.fundoNome}`} />
    <Suspense fallback={<p role="status" className="animate-pulse rounded-lg border p-6">Carregando a operação de e-mail…</p>}>
      <EmailOperationsPage fundoId={fundo.fundoId} basePath="/gestor/integracoes-email" params={params} />
    </Suspense>
  </PageContainer>
}
