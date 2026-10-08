import Link from 'next/link'
import { carregarDetalheNotificacao } from '@/lib/notificacoes/destino.server'
import { Card, CardContent } from '@/components/ui/card'

export default async function DetalheNotificacao({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ fundo?: string }>
}) {
  const { id } = await params
  const { fundo } = await searchParams
  let detalhe
  try {
    if (!fundo) throw new Error('Fundo obrigatório.')
    detalhe = await carregarDetalheNotificacao(id, { scope: 'FUNDO', fundoId: fundo })
  } catch {
    return <main className="mx-auto max-w-2xl space-y-4 p-6"><h1 className="text-xl font-semibold">Acesso não permitido</h1><p>O aviso não está disponível no Fundo atual ou seu acesso mudou.</p><Link className="text-blue-700 underline dark:text-blue-300" href="/">Voltar ao portal</Link></main>
  }
  return <main className="mx-auto max-w-2xl space-y-5 p-6">
    <Link className="text-sm text-blue-700 underline dark:text-blue-300" href={`/${detalhe.role}/notificacoes`}>Voltar às notificações</Link>
    <p className="text-sm text-muted-foreground">{detalhe.fundo}</p>
    <h1 className="text-2xl font-semibold">{detalhe.aviso.titulo}</h1>
    <p className="break-words text-muted-foreground">{detalhe.aviso.mensagem}</p>
    <Card><CardContent className="space-y-3 py-5">
      <h2 className="font-semibold">{detalhe.origem.label}</h2>
      <dl className="grid grid-cols-2 gap-3 text-sm"><dt>Status atual</dt><dd>{detalhe.origem.status}</dd><dt>Valor bruto</dt><dd>{detalhe.origem.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</dd></dl>
      <p className="text-xs text-muted-foreground">Consulta somente leitura. O acesso à entidade e ao Fundo é validado novamente a cada abertura.</p>
    </CardContent></Card>
  </main>
}
