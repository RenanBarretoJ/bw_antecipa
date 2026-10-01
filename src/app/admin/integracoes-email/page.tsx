import Link from 'next/link'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/authorization'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { EmailHealthPanel } from '@/components/email-intake/health-panel'

export default async function AdminEmailHealthPage({ searchParams }: { searchParams: Promise<{ fundo?: string }> }) {
  const auth = await requireRole('super_admin')
  const selected = z.uuid().safeParse((await searchParams).fundo)
  const { data: fundos, error } = await auth.supabase.from('fundos').select('id,nome').eq('ativo', true).order('nome').limit(100)
  if (error) throw new Error('Não foi possível consultar os fundos.')
  return <PageContainer className="space-y-5">
    <PageHeader title="Integrações de e-mail" description="Selecione o fundo para acompanhar as importações automáticas." />
    <nav className="flex flex-wrap gap-3" aria-label="Fundos">{fundos?.map(f => <Link className="text-sm underline" key={f.id} href={`/admin/integracoes-email?fundo=${f.id}`}>{f.nome}</Link>)}</nav>
    {selected.success && <EmailHealthPanel fundoId={selected.data} />}
  </PageContainer>
}
