import { assertRole, requireAuthenticated } from '@/lib/auth/authorization'
import { OperacaoDetalheFeature } from '@/app/cedente/operacoes/[id]/page'

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ returnTo?: string | string[] }>
}

export default async function ConsultorOperacaoDetalhePage(props: Props) {
  const auth = await requireAuthenticated()
  assertRole(auth.profile.role, ['consultor'])
  return <OperacaoDetalheFeature {...props} perfil="consultor" />
}
