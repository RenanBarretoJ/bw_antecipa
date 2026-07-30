import { connection } from 'next/server'
import { EscrowListagem } from '@/components/escrow/EscrowListagem'
import { parseFiltrosEscrow } from '@/lib/escrow/listagem'
import { carregarEscrowPaginado } from '@/lib/escrow/listagem.server'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function EscrowGestorPage({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  const filtros = parseFiltrosEscrow(await searchParams)
  const resultado = await carregarEscrowPaginado('gestor', filtros)
  return <EscrowListagem perfil="gestor" filtros={filtros} resultado={resultado} />
}
