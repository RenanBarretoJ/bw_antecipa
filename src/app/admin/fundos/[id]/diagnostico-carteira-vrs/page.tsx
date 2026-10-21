import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { diagnosticoCarteiraPermitido, hojeCarteira } from '@/lib/integracoes/vortx/carteira-diagnostic'
import { VortxCarteiraDiagnostic } from '@/components/admin/vortx-carteira-diagnostic'

export default async function CarteiraDiagnosticPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!diagnosticoCarteiraPermitido(id)) notFound()
  const context = await requireSuperAdmin()
  const { data: fund, error } = await context.supabase.from('fundos').select('id,nome,ativo').eq('id', id).single()
  if (error || !fund?.ativo) notFound()
  return <main className="mx-auto max-w-4xl space-y-6 p-6">
    <Link href={`/admin/fundos/${fund.id}?tab=integracoes`} className="text-primary underline">Voltar as integracoes</Link>
    <div><h1 className="text-2xl font-semibold">Diagnostico Carteira JSON · Preview</h1><p className="text-muted-foreground">{fund.nome}</p></div>
    <VortxCarteiraDiagnostic fundoId={fund.id} hoje={hojeCarteira()} />
  </main>
}
