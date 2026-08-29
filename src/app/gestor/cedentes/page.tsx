import { connection } from 'next/server'
import { CedentesGestorListagem } from '@/components/cedentes/CedentesGestorListagem'
import { parseFiltrosCedentesGestor } from '@/lib/cedentes/gestor-listagem'
import { carregarCedentesGestorPaginados } from '@/lib/cedentes/gestor-listagem.server'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function GestorCedentesPage({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  const filtros = parseFiltrosCedentesGestor(await searchParams)
  const resultado = await carregarCedentesGestorPaginados(filtros)
  return <CedentesGestorListagem filtros={filtros} resultado={resultado} />
}
