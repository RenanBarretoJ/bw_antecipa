import { connection } from 'next/server'
import { NotasFiscaisGestorListagem } from '@/components/notas-fiscais/NotasFiscaisGestorListagem'
import { parseFiltrosNotasFiscaisGestor } from '@/lib/notas-fiscais/gestor-listagem'
import { carregarNotasFiscaisGestorPaginadas } from '@/lib/notas-fiscais/gestor-listagem.server'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function NotasFiscaisGestorPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await connection()
  const filtros = parseFiltrosNotasFiscaisGestor(await searchParams)
  const resultado = await carregarNotasFiscaisGestorPaginadas(filtros)

  return <NotasFiscaisGestorListagem filtros={filtros} resultado={resultado} />
}
