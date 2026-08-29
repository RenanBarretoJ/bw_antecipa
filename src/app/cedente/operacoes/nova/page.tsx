import { connection } from 'next/server'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { carregarNovaSolicitacaoOperacao } from '@/lib/operacoes/nova-solicitacao.server'
import { mensagemBloqueioNovaSolicitacao } from '@/lib/operacoes/nova-solicitacao-block'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import NovaSolicitacaoClient from './nova-solicitacao-client'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

async function carregarEstadoNovaSolicitacao(searchParams: SearchParams) {
  try {
    return { resultado: await carregarNovaSolicitacaoOperacao(await searchParams), bloqueio: null }
  } catch (error) {
    const bloqueio = mensagemBloqueioNovaSolicitacao(error)
    if (!bloqueio) throw error
    return { resultado: null, bloqueio }
  }
}

export default async function NovaSolicitacaoPage({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  const { resultado, bloqueio } = await carregarEstadoNovaSolicitacao(searchParams)

  if (resultado) {
    return <NovaSolicitacaoClient resultado={resultado} />
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/cedente/operacoes"><Button variant="ghost"><ArrowLeft /> Voltar para operacoes</Button></Link>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertTriangle className="text-warning" /> Nova solicitacao indisponivel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">{bloqueio}</p>
          <p className="text-sm text-muted-foreground">O historico existente permanece disponivel. Solicite ao gestor do fundo a publicacao da configuracao operacional antes de criar uma nova operacao.</p>
        </CardContent>
      </Card>
    </div>
  )
}
