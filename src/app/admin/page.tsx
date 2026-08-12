import { Building2, KeyRound, ShieldCheck } from 'lucide-react'
import { MetricCard } from '@/components/data-display/primitives'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'

export default async function AdminPage() {
  await requireSuperAdmin()

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        eyebrow="Administracao da plataforma"
        title="BW Antecipa"
        description="Fundacao administrativa ativa e isolada dos contextos operacionais por fundo."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Fundacao administrativa" value="Ativa" description="Acesso validado por papel complementar" icon={ShieldCheck} tone="success" />
        <MetricCard label="Seguranca" value="MFA obrigatorio" description="Sessao forte com validade operacional" icon={KeyRound} tone="primary" />
        <MetricCard label="Contexto de fundo" value="Independente" description="Nenhum fundo e selecionado nesta area" icon={Building2} tone="info" />
      </div>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">Escopo do SA0</h2>
        <p className="mt-2 text-sm text-muted-foreground">Esta area confirma a fundacao do Super Admin. Cadastros globais, gestao de usuarios e operacoes administrativas adicionais pertencem aos proximos escopos.</p>
      </section>
    </PageContainer>
  )
}
