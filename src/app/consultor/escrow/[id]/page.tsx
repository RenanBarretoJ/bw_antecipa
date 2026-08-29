import { notFound } from 'next/navigation'
import { EscrowDetalhe } from '@/components/escrow/EscrowDetalhe'
import { carregarContaEscrowAutorizada, carregarMovimentosEscrow } from '@/lib/escrow/movimentos.server'

export default async function EscrowDetalheConsultorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { conta } = await carregarContaEscrowAutorizada('consultor', id)
  if (!conta) notFound()
  const inicial = await carregarMovimentosEscrow('consultor', id)
  return <EscrowDetalhe perfil="consultor" conta={conta} inicial={inicial} />
}
