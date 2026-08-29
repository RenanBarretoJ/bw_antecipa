import { connection } from 'next/server'
import { AprovacoesSacadoListagem } from '@/components/sacado/AprovacoesSacadoListagem'
import { parseFiltrosAprovacoesSacado } from '@/lib/sacado/portal-listagens'
import { carregarAprovacoesSacado } from '@/lib/sacado/portal-loaders.server'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function AprovacaoCessaoPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await connection()
  const filtros = parseFiltrosAprovacoesSacado(await searchParams)
  const resultado = await carregarAprovacoesSacado(filtros)
  return <AprovacoesSacadoListagem filtros={filtros} resultado={resultado} />
}
