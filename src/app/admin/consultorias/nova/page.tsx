import Link from 'next/link'
import { ConsultoriaCreateForm } from '@/components/admin/consultoria-create-form'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { listarAdminFundos } from '@/lib/admin/fundos.server'

export default async function NovaConsultoriaPage() {
  const fundos = await listarAdminFundos({ busca: '', status: 'ativos', pagina: 1, porPagina: 100 })
  return <PageContainer><PageHeader eyebrow="Estrutura global" title="Nova Consultoria" description="Cadastre a organizacao, autorize Fundos e convide o primeiro usuario OWNER sem definir senha." action={<Link href="/admin/consultorias" className="text-sm font-medium text-primary hover:underline">Voltar as Consultorias</Link>} /><section className="rounded-xl border border-border bg-card p-5 shadow-sm"><ConsultoriaCreateForm fundos={fundos.itens} /></section></PageContainer>
}
