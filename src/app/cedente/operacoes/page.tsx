import { connection } from 'next/server'
import { OperacoesPaginadas } from '@/components/operacoes/OperacoesPaginadas'
import { parseFiltrosOperacoes } from '@/lib/operacoes/listagem'
import { carregarOperacoesPaginadas } from '@/lib/operacoes/listagem.server'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function OperacoesCedentePage({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  const filtros = parseFiltrosOperacoes(await searchParams)
  const resultado = await carregarOperacoesPaginadas('cedente', filtros)
  return <OperacoesPaginadas perfil="cedente" filtros={filtros} resultado={resultado} />
}
