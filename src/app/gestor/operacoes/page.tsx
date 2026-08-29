import { connection } from 'next/server'
import { OperacoesPaginadas } from '@/components/operacoes/OperacoesPaginadas'
import { parseFiltrosOperacoes } from '@/lib/operacoes/listagem'
import { carregarOperacoesPaginadas } from '@/lib/operacoes/listagem.server'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function OperacoesGestorPage({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  const filtros = parseFiltrosOperacoes(await searchParams)
  const resultado = await carregarOperacoesPaginadas('gestor', filtros)
  return <OperacoesPaginadas perfil="gestor" filtros={filtros} resultado={resultado} />
}
