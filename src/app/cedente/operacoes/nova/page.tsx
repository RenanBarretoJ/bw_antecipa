import { connection } from 'next/server'
import { carregarNovaSolicitacaoOperacao } from '@/lib/operacoes/nova-solicitacao.server'
import NovaSolicitacaoClient from './nova-solicitacao-client'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function NovaSolicitacaoPage({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  const resultado = await carregarNovaSolicitacaoOperacao(await searchParams)
  return <NovaSolicitacaoClient resultado={resultado} />
}
