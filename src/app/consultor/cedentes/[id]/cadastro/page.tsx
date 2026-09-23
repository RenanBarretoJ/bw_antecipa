import { CadastroCedenteFeature } from '@/app/cedente/cadastro/page'
import { requireCedenteManagementAccess } from '@/lib/auth/authorization'

export default async function CadastroCedenteConsultorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireCedenteManagementAccess(id)
  return <CadastroCedenteFeature managedCedenteId={id} documentosPath={`/consultor/cedentes/${id}/documentos`} />
}
