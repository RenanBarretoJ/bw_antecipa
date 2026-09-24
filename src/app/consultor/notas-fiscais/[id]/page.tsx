import { notFound } from 'next/navigation'
import { assertRole, requireAuthenticated } from '@/lib/auth/authorization'
import { resolverContextoOperacionalNotaFiscal, validarNotaNoContextoSelecionado } from '@/lib/notas-fiscais/contexto-operacional.server'
import { NotaFiscalDetalheFeature } from '@/app/cedente/notas-fiscais/[id]/page'

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ cedente?: string | string[] }>
}

export default async function NotaFiscalConsultorPage({ params, searchParams }: Props) {
  const auth = await requireAuthenticated()
  assertRole(auth.profile.role, ['consultor'])
  const [{ id }, query] = await Promise.all([params, searchParams])
  const cedenteId = Array.isArray(query.cedente) ? query.cedente[0] : query.cedente
  if (!cedenteId) notFound()

  try {
    const contexto = await resolverContextoOperacionalNotaFiscal(auth, cedenteId)
    await validarNotaNoContextoSelecionado(auth.supabase, id, contexto)
  } catch {
    notFound()
  }

  return (
    <NotaFiscalDetalheFeature
      basePath="/consultor/notas-fiscais"
      cedenteIdSelecionado={cedenteId}
    />
  )
}
