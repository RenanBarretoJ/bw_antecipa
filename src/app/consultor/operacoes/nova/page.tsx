import { connection } from 'next/server'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { AuthorizationError, assertRole, requireAuthenticated } from '@/lib/auth/authorization'
import { carregarNovaSolicitacaoOperacao } from '@/lib/operacoes/nova-solicitacao.server'
import { mensagemBloqueioNovaSolicitacao } from '@/lib/operacoes/nova-solicitacao-block'
import NovaSolicitacaoClient from '@/app/cedente/operacoes/nova/nova-solicitacao-client'
import { ConsultorCedenteSelector } from '@/components/operacoes/ConsultorCedenteSelector'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function valorUnico(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : null
}

function CabecalhoSelecaoConsultor() {
  return (
    <div className="mx-auto max-w-[1440px]">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/consultor/operacoes"><Button variant="ghost" size="icon"><ArrowLeft /></Button></Link>
        <div>
          <h1 className="text-2xl font-bold">Nova solicitacao de antecipacao</h1>
          <p className="text-muted-foreground">Selecione o Cedente para carregar somente as NFs elegiveis da carteira.</p>
        </div>
      </div>
      <Card>
        <CardContent className="py-4">
          <ConsultorCedenteSelector selecionado={null} />
        </CardContent>
      </Card>
    </div>
  )
}

async function carregarEstadoNovaSolicitacao(
  params: Record<string, string | string[] | undefined>,
  cedenteId: string,
) {
  try {
    return {
      resultado: await carregarNovaSolicitacaoOperacao(params, { cedenteId }),
      bloqueio: null,
    }
  } catch (error) {
    const bloqueio = mensagemBloqueioNovaSolicitacao(error)
      || (error instanceof AuthorizationError ? error.message : null)
    if (!bloqueio) throw error
    return { resultado: null, bloqueio }
  }
}

export default async function NovaSolicitacaoConsultorPage({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  const auth = await requireAuthenticated()
  assertRole(auth.profile.role, ['consultor'])
  const params = await searchParams
  const cedenteId = valorUnico(params.cedente)

  if (!cedenteId) return <CabecalhoSelecaoConsultor />
  const { resultado, bloqueio } = await carregarEstadoNovaSolicitacao(params, cedenteId)

  if (resultado) {
    return <NovaSolicitacaoClient key={resultado.cedente.id} resultado={resultado} />
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <CabecalhoSelecaoConsultor />
      <Card className="mx-auto max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="text-warning" /> Nova solicitacao indisponivel
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{bloqueio}</p>
        </CardContent>
      </Card>
    </div>
  )
}
