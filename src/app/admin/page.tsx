import Link from 'next/link'
import { Building2, CircleOff, ShieldCheck, UserRoundCog } from 'lucide-react'
import { MetricCard } from '@/components/data-display/primitives'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { carregarResumoAdminFundos } from '@/lib/admin/fundos.server'
import { carregarResumoAdminUsuarios } from '@/lib/admin/usuarios.server'

const linkButton = 'inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80'

export default async function AdminPage() {
  const [resumo, usuarios] = await Promise.all([carregarResumoAdminFundos(), carregarResumoAdminUsuarios()])

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        eyebrow="Administracao da plataforma"
        title="Visao geral"
        description="Administracao estrutural independente do contexto operacional de fundos."
        action={<Link href="/admin/fundos/novo" className={linkButton}>Cadastrar fundo</Link>}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Fundos cadastrados" value={resumo.total} description="Estruturas registradas na plataforma" icon={Building2} tone="primary" />
        <MetricCard label="Fundos ativos" value={resumo.ativos} description="Disponiveis para contextos operacionais" icon={ShieldCheck} tone="success" />
        <MetricCard label="Fundos inativos" value={resumo.inativos} description="Preservados e fora da operacao" icon={CircleOff} tone="warning" />
        <MetricCard label="Usuarios ativos" value={usuarios.ativos} description={`${usuarios.gestores} Gestores e ${usuarios.super_admins} Super Admins`} icon={UserRoundCog} tone="info" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">Administracao de fundos</h2>
          <p className="mt-2 text-sm text-muted-foreground">Crie e mantenha a identidade estrutural dos fundos. Politicas, templates, CNAB e integracoes continuam no contexto operacional do gestor.</p>
          <Link href="/admin/fundos" className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline">Ver todos os fundos</Link>
        </section>
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">Usuarios & Acessos</h2>
          <p className="mt-2 text-sm text-muted-foreground">Convide Gestores e Super Admins, preserve papeis e controle vinculos explicitos sem conceder acesso operacional global.</p>
          <Link href="/admin/usuarios" className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline">Administrar usuarios</Link>
        </section>
      </div>
    </PageContainer>
  )
}
