import { connection } from 'next/server'
import { DocumentosGestorListagem } from '@/components/documentos/DocumentosGestorListagem'
import { parseFiltrosDocumentosGestor } from '@/lib/documentos/gestor-listagem'
import { carregarDocumentosGestorPaginados } from '@/lib/documentos/gestor-listagem.server'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function DocumentosGestorPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await connection()
  const filtros = parseFiltrosDocumentosGestor(await searchParams)
  const resultado = await carregarDocumentosGestorPaginados(filtros)

  return <DocumentosGestorListagem filtros={filtros} resultado={resultado} />
}
