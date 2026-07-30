import { connection } from 'next/server'
import { EscrowListagem } from '@/components/escrow/EscrowListagem'
import { parseFiltrosEscrow } from '@/lib/escrow/listagem'
import { carregarEscrowPaginado } from '@/lib/escrow/listagem.server'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function EscrowConsultorPage({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  const filtros = parseFiltrosEscrow(await searchParams)
  const resultado = await carregarEscrowPaginado('consultor', filtros)
  return <EscrowListagem perfil="consultor" filtros={filtros} resultado={resultado} />
}
