import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Building2, Briefcase, Users } from 'lucide-react'
import { ConsultoriaFundsForm, ConsultoriaInviteForm, ConsultoriaLifecycleAction, ConsultoriaUserRow } from '@/components/admin/consultoria-manager'
import { DetailField, DetailSection, EmptyState, FieldGrid, ListNameCell, StatusBadge } from '@/components/data-display/primitives'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { listarAdminFundos } from '@/lib/admin/fundos.server'
import { obterAdminConsultoria } from '@/lib/admin/consultorias.server'
import { formatCNPJ } from '@/lib/utils'

export default async function AdminConsultoriaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [consultoria, fundos] = await Promise.all([
    obterAdminConsultoria(id),
    listarAdminFundos({ busca: '', status: 'ativos', pagina: 1, porPagina: 100 }),
  ])
  if (!consultoria) notFound()
  return (
    <PageContainer className="space-y-5">
      <PageHeader eyebrow="Consultoria" title={consultoria.nome_fantasia || consultoria.razao_social} description={`${consultoria.razao_social} · ${formatCNPJ(consultoria.cnpj)}`} action={<><StatusBadge status={consultoria.status === 'ativo' ? 'ativo' : 'desativada'} label={consultoria.status === 'ativo' ? 'Ativa' : 'Inativa'} /><ConsultoriaLifecycleAction consultoria={consultoria} /></>} />
      <Link href="/admin/consultorias" className="text-sm font-medium text-primary hover:underline">Voltar as Consultorias</Link>
      <DetailSection title="Dados da organizacao" icon={Building2}><FieldGrid><DetailField label="Razao Social" value={consultoria.razao_social} /><DetailField label="Nome Fantasia" value={consultoria.nome_fantasia || 'Nao informado'} /><DetailField label="CNPJ" value={formatCNPJ(consultoria.cnpj)} /><DetailField label="Status" value={consultoria.status} /></FieldGrid></DetailSection>
      <DetailSection title="Usuarios" icon={Users}>
        <ConsultoriaInviteForm consultorId={consultoria.id} disabled={consultoria.status !== 'ativo'} />
        <div className="mt-5 divide-y divide-border">{consultoria.usuarios.map((usuario) => <ConsultoriaUserRow key={usuario.id} consultorId={consultoria.id} usuario={usuario} />)}</div>
      </DetailSection>
      <DetailSection title="Fundos autorizados" icon={Building2}><ConsultoriaFundsForm consultoria={consultoria} fundos={fundos.itens} /></DetailSection>
      <DetailSection title="Cedentes da carteira" icon={Briefcase}>{consultoria.cedentes.length === 0 ? <EmptyState title="Nenhum Cedente vinculado" description="Os Cedentes criados por usuarios autorizados serao vinculados a organizacao, sem duplicacao por usuario." icon={Briefcase} /> : <div className="divide-y divide-border">{consultoria.cedentes.map((cedente) => <div key={cedente.id} className="grid items-center gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_140px_140px]"><ListNameCell name={cedente.razao_social} subline={formatCNPJ(cedente.cnpj)} className="max-w-none" /><StatusBadge status={cedente.status === 'ativo' ? 'ativo' : 'pendente'} label={cedente.status} /><StatusBadge status={cedente.vinculo_status === 'ativo' ? 'ativo' : 'pendente'} label={`Vinculo ${cedente.vinculo_status}`} /></div>)}</div>}</DetailSection>
    </PageContainer>
  )
}
