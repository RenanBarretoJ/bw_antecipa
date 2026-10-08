import { notFound } from 'next/navigation'
import {
  assertRole,
  requireAuthenticated,
  requireNotaFiscalViewAccess,
} from '@/lib/auth/authorization'
import {
  resolverContextoLeituraNotaFiscal,
  resolverContextoOperacionalNotaFiscal,
  validarNotaNoContextoSelecionado,
} from '@/lib/notas-fiscais/contexto-operacional.server'
import { NotaFiscalDetalheFeature } from '@/app/cedente/notas-fiscais/[id]/page'
import { carregarMembershipConsultorAtiva } from '@/lib/consultor/membership.server'

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
  const membership = await carregarMembershipConsultorAtiva(auth)
  const somenteLeitura = membership.papel === 'LEITOR'

  try {
    const contexto = somenteLeitura
      ? await resolverContextoLeituraNotaFiscal(auth, cedenteId)
      : await resolverContextoOperacionalNotaFiscal(auth, cedenteId)
    if (somenteLeitura) await requireNotaFiscalViewAccess(id, auth.supabase)
    await validarNotaNoContextoSelecionado(auth.supabase, id, contexto)
  } catch {
    notFound()
  }

  return (
    <NotaFiscalDetalheFeature
      basePath="/consultor/notas-fiscais"
      cedenteIdSelecionado={cedenteId}
      somenteLeitura={somenteLeitura}
    />
  )
}
