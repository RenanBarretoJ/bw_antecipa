'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Eye, Search } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ListPagination } from '@/components/pagination'
import { RemoteEntitySelector } from '@/components/selectors/RemoteEntitySelector'
import { DataTableContainer, EmptyState, ListNameCell, StatusBadge } from '@/components/data-display/primitives'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { FiltrosCedentesGestor, ResultadoCedentesGestor } from '@/lib/cedentes/gestor-listagem'
import { buildListUrl } from '@/lib/pagination'
import { formatCNPJ, formatDate } from '@/lib/utils'

export function CedentesGestorListagem({ filtros, resultado }: {
  filtros: FiltrosCedentesGestor
  resultado: ResultadoCedentesGestor
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

  const returnTo = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ''}`
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Relacionamento</p>
        <h1 className="text-2xl font-bold">Cedentes</h1>
        <p className="text-muted-foreground">Cadastro e situação dos cedentes do fundo ativo.</p>
      </div>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(event) => setBusca(event.target.value)} className="pl-9" placeholder="Buscar por CNPJ ou razão social..." />
        </div>
        <Select value={filtros.status || 'todos'} onValueChange={(value) => navegar({ status: value === 'todos' ? null : value, page: 1 })}>
          <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="pendente">Pendente</SelectItem>
            <SelectItem value="em_analise">Em análise</SelectItem>
            <SelectItem value="ativo">Ativo</SelectItem>
            <SelectItem value="reprovado">Reprovado</SelectItem>
            <SelectItem value="bloqueado">Bloqueado</SelectItem>
          </SelectContent>
        </Select>
        <RemoteEntitySelector className="w-full sm:w-64" tipo="politica" value={filtros.politicaId} placeholder="Todas as políticas" onChange={(value) => navegar({ politica: value, page: 1 })} />
      </div>
      <DataTableContainer className={isPending ? 'opacity-70' : undefined}>
        {resultado.items.length === 0 ? (
          <EmptyState title="Nenhum cedente encontrado" description="Ajuste os filtros ou confira os vínculos do fundo ativo." />
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Cedente</TableHead><TableHead>Política</TableHead><TableHead>Cadastro</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead>
            </TableRow></TableHeader>
            <TableBody>{resultado.items.map((cedente) => (
              <TableRow key={cedente.cedenteFundoId}>
                <TableCell className="max-w-[320px]"><ListNameCell name={cedente.razaoSocial} subline={formatCNPJ(cedente.cnpj)} /></TableCell>
                <TableCell className="max-w-[220px] truncate" title={cedente.politica?.nome}>{cedente.politica?.nome || 'Sem política'}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(cedente.criadoEm)}</TableCell>
                <TableCell><StatusBadge status={cedente.status} /></TableCell>
                <TableCell className="text-right"><Link href={`/gestor/cedentes/${cedente.id}?returnTo=${encodeURIComponent(returnTo)}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary"><Eye className="size-4" /> Ver detalhes</Link></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
        <ListPagination className="border-t px-4 py-3" pagination={resultado.pagination} disabled={isPending} onPageChange={(page) => navegar({ page })} onPageSizeChange={(pageSize) => navegar({ pageSize, page: 1 })} />
      </DataTableContainer>
    </div>
  )
}
