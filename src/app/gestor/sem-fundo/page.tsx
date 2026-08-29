import { Building2 } from 'lucide-react'
import { EmptyState } from '@/components/data-display/primitives'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { requireGestor } from '@/lib/auth/authorization'

export default async function GestorSemFundoPage() {
  await requireGestor()

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        eyebrow="Acesso operacional"
        title="Nenhum fundo autorizado"
        description="Seu perfil gestor esta ativo, mas ainda nao possui vinculo com um fundo operacional."
      />
      <section className="rounded-xl border border-border bg-card shadow-sm">
        <EmptyState
          icon={Building2}
          title="Aguardando autorizacao de fundo"
          description="Solicite ao administrador responsavel a inclusao do seu usuario em um fundo. Assim que o vinculo estiver ativo, o portal operacional sera liberado."
        />
      </section>
    </PageContainer>
  )
}
