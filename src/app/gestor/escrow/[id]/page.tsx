import { notFound } from 'next/navigation'
import { EscrowDetalhe } from '@/components/escrow/EscrowDetalhe'
import { carregarContaEscrowAutorizada, carregarMovimentosEscrow } from '@/lib/escrow/movimentos.server'

export default async function EscrowDetalheGestorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { conta } = await carregarContaEscrowAutorizada('gestor', id)
  if (!conta) notFound()
  const inicial = await carregarMovimentosEscrow('gestor', id)
  return <EscrowDetalhe perfil="gestor" conta={conta} inicial={inicial} />
}
