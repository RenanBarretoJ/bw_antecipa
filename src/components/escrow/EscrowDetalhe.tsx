'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowDownCircle, ArrowLeft, ArrowUpCircle, Calendar, Lock, TrendingUp, Wallet } from 'lucide-react'
import { carregarMaisMovimentosEscrow } from '@/lib/actions/escrow'
import type {
  ContaEscrowDetalhe,
  FiltrosMovimentos,
  MovimentoEscrowItem,
  PerfilExtrato,
  ResultadoMovimentos,
} from '@/lib/escrow/movimentos'
import { formatCNPJ, formatCurrency } from '@/lib/utils'
import { LoadMoreButton } from '@/components/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function EscrowDetalhe({ perfil, conta, inicial }: {
  perfil: PerfilExtrato
  conta: ContaEscrowDetalhe
  inicial: ResultadoMovimentos
}) {
  const [resultado, setResultado] = useState(inicial)
  const [filtros, setFiltros] = useState<FiltrosMovimentos>({ tipo: null, dataInicio: '', dataFim: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const consultar = async (append: boolean) => {
    setLoading(true)
    setError(null)
    const response = await carregarMaisMovimentosEscrow({
      perfil,
      contaId: conta.id,
      filtros,
      cursor: append ? resultado.nextCursor : null,
    })
    if (!response.success) {
      setError(response.message)
    } else {
      setResultado(append ? {
        ...response.resultado,
        items: [...resultado.items, ...response.resultado.items],
      } : response.resultado)
    }
    setLoading(false)
  }

  const totalCreditos = resultado.items.filter((item) => item.tipo === 'credito').reduce((total, item) => total + item.valor, 0)
  const totalDebitos = resultado.items.filter((item) => item.tipo === 'debito').reduce((total, item) => total + item.valor, 0)
  const voltar = perfil === 'cedente' ? '/cedente/dashboard' : `/${perfil}/escrow`

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href={voltar} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Voltar</Link>
      <div className="flex items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold">{conta.identificador}</h1><p className="text-muted-foreground">{conta.cedente.nome} — {formatCNPJ(conta.cedente.cnpj)}</p></div>
        <Badge variant={conta.status === 'ativa' ? 'default' : 'destructive'}>{conta.status}</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="p-4"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Wallet className="size-4 text-green-600" /> Disponível</p><p className="mt-1 text-2xl font-bold text-green-700">{formatCurrency(conta.saldoDisponivel)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Lock className="size-4 text-yellow-600" /> Bloqueado</p><p className="mt-1 text-2xl font-bold text-yellow-700">{formatCurrency(conta.saldoBloqueado)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="size-4 text-blue-600" /> Total</p><p className="mt-1 text-2xl font-bold text-blue-700">{formatCurrency(conta.saldoDisponivel + conta.saldoBloqueado)}</p></CardContent></Card>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-green-50 dark:bg-green-900/20"><CardContent className="p-4"><p className="text-xs text-green-700">Créditos carregados</p><p className="text-xl font-bold text-green-700">{formatCurrency(totalCreditos)}</p></CardContent></Card>
        <Card className="bg-red-50 dark:bg-red-900/20"><CardContent className="p-4"><p className="text-xs text-red-700">Débitos carregados</p><p className="text-xl font-bold text-red-700">{formatCurrency(totalDebitos)}</p></CardContent></Card>
      </div>
      <Card><CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
        <div className="flex flex-1 items-center gap-2"><Calendar className="size-4 text-muted-foreground" /><Input type="date" value={filtros.dataInicio} onChange={(event) => setFiltros((atual) => ({ ...atual, dataInicio: event.target.value }))} /><span className="text-sm text-muted-foreground">até</span><Input type="date" value={filtros.dataFim} onChange={(event) => setFiltros((atual) => ({ ...atual, dataFim: event.target.value }))} /></div>
        <Select value={filtros.tipo || 'todos'} onValueChange={(value) => setFiltros((atual) => ({ ...atual, tipo: value === 'todos' ? null : value as FiltrosMovimentos['tipo'] }))}><SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos</SelectItem><SelectItem value="credito">Créditos</SelectItem><SelectItem value="debito">Débitos</SelectItem></SelectContent></Select>
        <Button type="button" variant="outline" disabled={loading} onClick={() => consultar(false)}>Aplicar</Button>
      </CardContent></Card>
      <Card>
        {resultado.items.length === 0 ? <CardContent className="py-14 text-center text-muted-foreground">Nenhum movimento encontrado.</CardContent> : <Table>
          <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Saldo após</TableHead></TableRow></TableHeader>
          <TableBody>{resultado.items.map((movimento: MovimentoEscrowItem) => <TableRow key={movimento.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(movimento.criadoEm).toLocaleString('pt-BR')}</TableCell>
            <TableCell>{movimento.tipo === 'credito' ? <Badge className="gap-1"><ArrowUpCircle className="size-3" /> Crédito</Badge> : <Badge variant="destructive" className="gap-1"><ArrowDownCircle className="size-3" /> Débito</Badge>}</TableCell>
            <TableCell>{movimento.descricao}</TableCell>
            <TableCell className={`text-right font-semibold ${movimento.tipo === 'credito' ? 'text-green-700' : 'text-destructive'}`}>{movimento.tipo === 'credito' ? '+' : '-'}{formatCurrency(movimento.valor)}</TableCell>
            <TableCell className="text-right text-muted-foreground">{formatCurrency(movimento.saldoApos)}</TableCell>
          </TableRow>)}</TableBody>
        </Table>}
        <LoadMoreButton className="border-t p-4" hasMore={resultado.hasMore} loading={loading} error={error} onLoadMore={() => consultar(true)} />
      </Card>
    </div>
  )
}
