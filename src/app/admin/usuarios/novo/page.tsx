import Link from 'next/link'
import { AdminUserInviteForm } from '@/components/admin/admin-user-invite-form'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { listarAdminFundos } from '@/lib/admin/fundos.server'

export default async function NovoUsuarioAdminPage() {
  const fundos = await listarAdminFundos({ busca: '', status: 'todos', pagina: 1, porPagina: 100 })
  return (
    <PageContainer>
      <PageHeader eyebrow="Estrutura global" title="Novo usuario administrativo" description="Envie um convite sem definir ou armazenar senha. O MFA permanecera obrigatorio no primeiro acesso." action={<Link href="/admin/usuarios" className="text-sm font-medium text-primary hover:underline">Voltar aos usuarios</Link>} />
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm"><AdminUserInviteForm fundos={fundos.itens} /></section>
    </PageContainer>
  )
}
