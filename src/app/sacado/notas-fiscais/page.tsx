import { connection } from 'next/server'
import { FiltroEmpresaSacado } from '@/components/sacado/FiltroEmpresaSacado'
import { NotasFiscaisSacadoListagem } from '@/components/sacado/NotasFiscaisSacadoListagem'
import { parseFiltrosNfsSacado } from '@/lib/sacado/portal-listagens'
import { carregarNotasFiscaisSacado } from '@/lib/sacado/portal-loaders.server'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function NfsRecebidasSacadoPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await connection()
  const filtros = parseFiltrosNfsSacado(await searchParams)
  const resultado = await carregarNotasFiscaisSacado(filtros)
  return <><FiltroEmpresaSacado cnpj={filtros.cnpj} /><NotasFiscaisSacadoListagem filtros={filtros} resultado={resultado} /></>
}
