'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Eye, Search, Wallet } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ListNameCell } from '@/components/data-display/primitives'
import { ListPagination } from '@/components/pagination'
import { RemoteEntitySelector } from '@/components/selectors/RemoteEntitySelector'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { FiltrosEscrow, ResultadoEscrow } from '@/lib/escrow/listagem'
import { buildListUrl } from '@/lib/pagination'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'

export function EscrowListagem({ perfil, filtros, resultado }: {
  perfil: 'gestor' | 'consultor'
  filtros: FiltrosEscrow
  resultado: ResultadoEscrow
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [busca, setBusca] = useState(filtros.q)
  const current = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams])
  const navegar = (updates: Record<string, string | number | null>) => {
    startTransition(() => router.replace(buildListUrl(pathname, current, updates)))
  }
  useEffect(() => {
    if (busca === filtros.q) return
    const timer = window.setTimeout(() => navegar({ q: busca || null, page: 1 }), 350)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, filtros.q])

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{perfil === 'gestor' ? 'Contas Escrow' : 'Extratos Escrow'}</h1>
        <p className="text-muted-foreground">{perfil === 'gestor' ? 'Contas vinculadas ao fundo ativo.' : 'Contas dos cedentes da sua carteira, em somente leitura.'}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total no filtro</p><p className="text-2xl font-bold">{resultado.pagination.total}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ativas na página</p><p className="text-2xl font-bold">{resultado.metricasPagina.ativas}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Disponível na página</p><p className="text-xl font-bold text-green-700">{formatCurrency(resultado.metricasPagina.saldoDisponivel)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Bloqueado na página</p><p className="text-xl font-bold text-yellow-700">{formatCurrency(resultado.metricasPagina.saldoBloqueado)}</p></CardContent></Card>
      </div>
      <Card><CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar por identificador, cedente ou CNPJ..." />
        </div>
        <Select value={filtros.status || 'todos'} onValueChange={(value) => navegar({ status: value === 'todos' ? null : value, page: 1 })}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todos">Todos os status</SelectItem><SelectItem value="ativa">Ativa</SelectItem><SelectItem value="bloqueada">Bloqueada</SelectItem><SelectItem value="encerrada">Encerrada</SelectItem></SelectContent>
        </Select>
        <RemoteEntitySelector className="w-full sm:w-64" tipo="cedente" value={filtros.cedenteId} placeholder="Todos os cedentes" onChange={(value) => navegar({ cedente: value, page: 1 })} />
      </CardContent></Card>
      <Card className={isPending ? 'opacity-70' : undefined}>
        {resultado.items.length === 0 ? <CardContent className="py-14 text-center text-muted-foreground"><Wallet className="mx-auto mb-3 size-10 opacity-30" />Nenhuma conta escrow encontrada.</CardContent> : (
          <Table>
            <TableHeader><TableRow><TableHead>Conta</TableHead><TableHead>Cedente</TableHead><TableHead className="text-right">Disponível</TableHead><TableHead className="text-right">Bloqueado</TableHead><TableHead>Status</TableHead><TableHead>Criada em</TableHead><TableHead>Ações</TableHead></TableRow></TableHeader>
            <TableBody>{resultado.items.map((conta) => <TableRow key={conta.id}>
              <TableCell className="font-mono">{conta.identificador}</TableCell>
              <TableCell className="max-w-[240px]"><ListNameCell name={conta.cedente.nome} subline={formatCNPJ(conta.cedente.cnpj)} /></TableCell>
              <TableCell className="text-right font-semibold text-green-700">{formatCurrency(conta.saldoDisponivel)}</TableCell>
              <TableCell className="text-right font-semibold text-yellow-700">{formatCurrency(conta.saldoBloqueado)}</TableCell>
              <TableCell><Badge variant={conta.status === 'ativa' ? 'default' : conta.status === 'bloqueada' ? 'secondary' : 'destructive'}>{conta.status}</Badge></TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(conta.criadoEm)}</TableCell>
              <TableCell><Link href={`/${perfil}/escrow/${conta.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary"><Eye className="size-4" /> Extrato</Link></TableCell>
            </TableRow>)}</TableBody>
          </Table>
        )}
        <ListPagination className="border-t px-4 py-3" pagination={resultado.pagination} disabled={isPending} onPageChange={(page) => navegar({ page })} onPageSizeChange={(pageSize) => navegar({ pageSize, page: 1 })} />
      </Card>
    </div>
  )
}
