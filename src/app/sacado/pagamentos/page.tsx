import { connection } from 'next/server'
import { PagamentosSacadoListagem } from '@/components/sacado/PagamentosSacadoListagem'
import { parseFiltrosPagamentosSacado } from '@/lib/sacado/portal-listagens'
import { carregarPagamentosSacado } from '@/lib/sacado/portal-loaders.server'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function HistoricoPagamentosPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await connection()
  const filtros = parseFiltrosPagamentosSacado(await searchParams)
  const resultado = await carregarPagamentosSacado(filtros)

  return (
    <PagamentosSacadoListagem
      filtros={filtros}
      resultado={resultado}
    />
  )
}
