import { connection } from 'next/server'
import { MeusEstabelecimentosClient } from './meus-estabelecimentos-client'
import { parseFiltrosEstabelecimentos } from '@/lib/cedentes/estabelecimentos-listagem'
import { carregarMeusEstabelecimentosPaginados } from '@/lib/cedentes/estabelecimentos-listagem.server'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function MeusEstabelecimentosPage({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  const filtros = parseFiltrosEstabelecimentos(await searchParams)
  const resultado = await carregarMeusEstabelecimentosPaginados(filtros)
  return <MeusEstabelecimentosClient filtros={filtros} resultado={resultado} />
}
