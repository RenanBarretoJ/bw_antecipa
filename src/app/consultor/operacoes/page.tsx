import { connection } from 'next/server'
import { OperacoesPaginadas } from '@/components/operacoes/OperacoesPaginadas'
import { parseFiltrosOperacoes } from '@/lib/operacoes/listagem'
import { carregarOperacoesPaginadas } from '@/lib/operacoes/listagem.server'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function OperacoesConsultorPage({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  const filtros = parseFiltrosOperacoes(await searchParams)
  const resultado = await carregarOperacoesPaginadas('consultor', filtros)
  return <OperacoesPaginadas perfil="consultor" filtros={filtros} resultado={resultado} />
}
