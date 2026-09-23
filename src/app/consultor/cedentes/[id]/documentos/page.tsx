import { DocumentosCedenteFeature } from '@/app/cedente/documentos/page'
import { requireCedenteManagementAccess } from '@/lib/auth/authorization'

export default async function DocumentosCedenteConsultorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requireCedenteManagementAccess(id)
  return <DocumentosCedenteFeature managedCedenteId={id} />
}
