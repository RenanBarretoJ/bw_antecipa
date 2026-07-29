'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  AlertCircle,
  Banknote,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Eye,
  FileText,
  Loader2,
  Search,
  Upload,
  Wrench,
  X,
  XCircle,
} from 'lucide-react'
import { aprovarNFsLote, reprovarNFsLote } from '@/lib/actions/nota-fiscal'
import {
  type CampoOrdenacaoNfGestor,
  type FiltrosNotasFiscaisGestor,
  type ResultadoNotasFiscaisGestor,
} from '@/lib/notas-fiscais/gestor-listagem'
import { buildListUrl } from '@/lib/pagination'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'
import { ListNameCell } from '@/components/data-display/primitives'
import { useNotifications } from '@/components/notifications/notification-provider'
import { ListPagination } from '@/components/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const statusConfig: Record<string, {
  label: string
  icon: typeof CheckCircle
  className: string
}> = {
  rascunho: { label: 'Rascunho', icon: FileText, className: '' },
  submetida: { label: 'Submetida', icon: Upload, className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  em_analise: { label: 'Em analise', icon: AlertCircle, className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  aprovada: { label: 'Validada', icon: CheckCircle, className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  em_antecipacao: { label: 'Em antecipacao', icon: Banknote, className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  aceita: { label: 'Antecipada', icon: CheckCircle, className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  contestada: { label: 'Contestada', icon: AlertCircle, className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  liquidada: { label: 'Liquidada', icon: CheckCircle, className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  cancelada: { label: 'Cancelada/Reprovada', icon: XCircle, className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  requer_ajuste: { label: 'Requer ajuste', icon: Wrench, className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
}

export function NotasFiscaisGestorListagem({
  filtros,
  resultado,
}: {
  filtros: FiltrosNotasFiscaisGestor
  resultado: ResultadoNotasFiscaisGestor
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const notifications = useNotifications()
  const [isPending, startTransition] = useTransition()
  const [busca, setBusca] = useState(filtros.q)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [modalReprovar, setModalReprovar] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [processandoLote, setProcessandoLote] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const currentParams = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams])
  const returnTo = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ''}`

  const navegar = (updates: Record<string, string | number | null>) => {
    setSelecionadas(new Set())
    startTransition(() => router.replace(buildListUrl(pathname, currentParams, updates)))
  }

  useEffect(() => {
    if (busca === filtros.q) return
    const timer = window.setTimeout(() => navegar({ q: busca || null, page: 1 }), 350)
    return () => window.clearTimeout(timer)
    // navegar acompanha os parametros atuais e nao deve reiniciar o debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, filtros.q])

  useEffect(() => {
    if (!selectAllRef.current) return
    const todos = resultado.items.length > 0
      && resultado.items.every((item) => selecionadas.has(item.id))
    const algum = resultado.items.some((item) => selecionadas.has(item.id))
    selectAllRef.current.checked = todos
    selectAllRef.current.indeterminate = algum && !todos
  }, [resultado.items, selecionadas])

  const selecionados = resultado.items.filter((item) => selecionadas.has(item.id))
  const metricas = selecionados.length
    ? {
      pendentes: selecionados.filter((item) => ['submetida', 'em_analise'].includes(item.status)).length,
      aprovadas: selecionados.filter((item) => item.status === 'aprovada').length,
      valor: selecionados.filter((item) => item.status !== 'cancelada').reduce((soma, item) => soma + item.valorBruto, 0),
      total: selecionados.length,
      legenda: `${selecionados.length} NF(s) selecionada(s)`,
    }
    : {
      ...resultado.metricasPagina,
      total: resultado.items.length,
      legenda: `${resultado.items.length} de ${resultado.pagination.total} NF(s) no filtro`,
    }
  const elegiveisSelecionadas = selecionados.filter(
    (item) => ['submetida', 'em_analise'].includes(item.status) && item.resumoDocumental.elegivel,
  ).length

  const toggleTodos = () => {
    const todosSelecionados = resultado.items.every((item) => selecionadas.has(item.id))
    setSelecionadas(todosSelecionados
      ? new Set()
      : new Set(resultado.items.map((item) => item.id)))
  }
  const toggleItem = (id: string) => {
    setSelecionadas((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })
  }
  const toggleSort = (sort: CampoOrdenacaoNfGestor) => {
    navegar({
      sort,
      direction: filtros.sort === sort && filtros.direction === 'asc' ? 'desc' : 'asc',
      page: 1,
    })
  }
  const sortIcon = (field: CampoOrdenacaoNfGestor) => {
    if (filtros.sort !== field) return <ChevronsUpDown size={11} className="opacity-30" />
    return filtros.direction === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
  }

  const aprovarLote = async () => {
    setProcessandoLote(true)
    const result = await aprovarNFsLote(Array.from(selecionadas))
    notifications.fromActionResult(result)
    if (result?.success) {
      setSelecionadas(new Set())
      startTransition(() => router.refresh())
    }
    setProcessandoLote(false)
  }
  const reprovarLote = async () => {
    if (!motivo.trim()) return
    setProcessandoLote(true)
    const result = await reprovarNFsLote(Array.from(selecionadas), motivo)
    notifications.fromActionResult(result)
    if (result?.success) {
      setSelecionadas(new Set())
      setModalReprovar(false)
      setMotivo('')
      startTransition(() => router.refresh())
    }
    setProcessandoLote(false)
  }

  const temFiltros = Boolean(
    filtros.q || filtros.status || filtros.cedenteId
    || filtros.vencimentoDe || filtros.vencimentoAte,
  )

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Notas Fiscais</h1>
        <p className="text-muted-foreground">Analise e gerencie as NFs dos cedentes.</p>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Pendentes na pagina', metricas.pendentes, 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300'],
          ['Aprovadas na pagina', metricas.aprovadas, 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'],
          ['NFs na pagina', metricas.total, 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'],
          ['Valor na pagina', formatCurrency(metricas.valor), 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300'],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className={`rounded-xl p-4 ${tone}`}>
            <p className="text-xs font-medium">{label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <p className="mb-5 pl-1 text-xs text-muted-foreground">{metricas.legenda}</p>

      <Card className="mb-4">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(event) => setBusca(event.target.value)} className="h-9 pl-9" placeholder="Buscar por numero, CNPJ ou razao social..." />
            </div>
            <Select value={filtros.status || 'todos'} onValueChange={(value) => navegar({ status: value === 'todos' ? null : value, page: 1 })}>
              <SelectTrigger className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {Object.entries(statusConfig).filter(([value]) => value !== 'rascunho').map(([value, config]) => (
                  <SelectItem key={value} value={value}>{config.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtros.cedenteId || 'todos'} onValueChange={(value) => navegar({ cedente: value === 'todos' ? null : value, page: 1 })}>
              <SelectTrigger className="h-9 w-[220px]"><SelectValue placeholder="Todos os cedentes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os cedentes</SelectItem>
                {resultado.cedentes.map((item) => <SelectItem key={item.id} value={item.id}>{item.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" aria-label="Vencimento inicial" value={filtros.vencimentoDe} onChange={(event) => navegar({ vencimentoDe: event.target.value || null, page: 1 })} className="h-9 w-[142px]" />
            <Input type="date" aria-label="Vencimento final" value={filtros.vencimentoAte} onChange={(event) => navegar({ vencimentoAte: event.target.value || null, page: 1 })} className="h-9 w-[142px]" />
            {temFiltros && <Button variant="ghost" size="sm" onClick={() => { setBusca(''); navegar({ q: null, status: null, cedente: null, vencimentoDe: null, vencimentoAte: null, page: 1 }) }}><X size={14} />Limpar</Button>}
          </div>
        </CardContent>
      </Card>

      {resultado.items.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <FileText size={48} className="mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-muted-foreground">Nenhuma NF encontrada.</p>
        </CardContent></Card>
      ) : (
        <Card className={isPending ? 'overflow-hidden opacity-70' : 'overflow-hidden'}>
          <div className="overflow-x-auto">
            <Table className="min-w-[1080px]">
              <TableHeader><TableRow>
                <TableHead className="w-10 px-4 py-3"><input ref={selectAllRef} type="checkbox" onChange={toggleTodos} aria-label="Selecionar todas da pagina" /></TableHead>
                <TableHead className="cursor-pointer px-4 py-3 text-xs uppercase" onClick={() => toggleSort('numero_nf')}><span className="flex items-center gap-1">NF {sortIcon('numero_nf')}</span></TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Cedente</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Sacado</TableHead>
                <TableHead className="cursor-pointer px-4 py-3 text-xs uppercase" onClick={() => toggleSort('valor_bruto')}><span className="flex items-center gap-1">Valor {sortIcon('valor_bruto')}</span></TableHead>
                <TableHead className="cursor-pointer px-4 py-3 text-xs uppercase" onClick={() => toggleSort('data_vencimento')}><span className="flex items-center gap-1">Vencimento {sortIcon('data_vencimento')}</span></TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Documentos</TableHead>
                <TableHead className="cursor-pointer px-4 py-3 text-xs uppercase" onClick={() => toggleSort('status')}><span className="flex items-center gap-1">Status {sortIcon('status')}</span></TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Acoes</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {resultado.items.map((item) => {
                  const status = statusConfig[item.status] || statusConfig.rascunho
                  const StatusIcon = status.icon
                  return <TableRow key={item.id} className={selecionadas.has(item.id) ? 'bg-primary/5' : undefined}>
                    <TableCell className="px-4 py-3"><input type="checkbox" checked={selecionadas.has(item.id)} onChange={() => toggleItem(item.id)} aria-label={`Selecionar NF ${item.numero}`} /></TableCell>
                    <TableCell className="px-4 py-3 font-medium">{item.numero}</TableCell>
                    <TableCell className="w-[210px] max-w-[210px] px-4 py-3"><ListNameCell name={item.cedente.nome} subline={formatCNPJ(item.cedente.cnpj)} /></TableCell>
                    <TableCell className="w-[210px] max-w-[210px] px-4 py-3"><ListNameCell name={item.sacado.nome || 'Nao informado'} subline={item.sacado.cnpj ? formatCNPJ(item.sacado.cnpj) : '—'} /></TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">{formatCurrency(item.valorBruto)}</TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3 text-muted-foreground">{item.vencimentoEm ? formatDate(item.vencimentoEm) : '—'}</TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3">
                      <Badge className={item.resumoDocumental.possuiRejeicao ? 'bg-red-100 text-red-700' : item.resumoDocumental.elegivel ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
                        {item.resumoDocumental.totalSatisfeitos}/{item.resumoDocumental.totalObrigatorios}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3"><Badge className={status.className}><StatusIcon size={12} />{status.label}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3">
                      <Link href={`/gestor/notas-fiscais/${item.id}?returnTo=${encodeURIComponent(returnTo)}`}><Button variant="ghost" size="sm"><Eye size={14} />Analisar</Button></Link>
                    </TableCell>
                  </TableRow>
                })}
              </TableBody>
            </Table>
          </div>
          <ListPagination className="border-t px-4 py-3" pagination={resultado.pagination} disabled={isPending} onPageChange={(page) => navegar({ page })} onPageSizeChange={(pageSize) => navegar({ pageSize, page: 1 })} />
        </Card>
      )}

      {selecionadas.size > 0 && <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-2xl border bg-background px-5 py-3 shadow-xl">
        <span className="whitespace-nowrap text-sm font-medium">{selecionadas.size} selecionada(s) <span className="font-normal text-muted-foreground">({elegiveisSelecionadas} elegiveis)</span></span>
        <Button size="sm" className="bg-green-600 text-white hover:bg-green-700" disabled={processandoLote || elegiveisSelecionadas !== selecionadas.size} onClick={aprovarLote}>{processandoLote ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}Aprovar em lote</Button>
        <Button size="sm" variant="destructive" disabled={processandoLote} onClick={() => setModalReprovar(true)}><XCircle size={13} />Reprovar em lote</Button>
        <Button size="icon" variant="ghost" onClick={() => setSelecionadas(new Set())}><X size={14} /></Button>
      </div>}

      {modalReprovar && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-xl">
          <div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">Reprovar NFs em lote</h3><Button variant="ghost" size="icon" onClick={() => setModalReprovar(false)}><X size={18} /></Button></div>
          <Label htmlFor="motivo-lote">Motivo da reprovacao</Label>
          <textarea id="motivo-lote" className="mt-1 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm" rows={3} value={motivo} onChange={(event) => setMotivo(event.target.value)} />
          <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setModalReprovar(false)}>Cancelar</Button><Button variant="destructive" disabled={processandoLote || !motivo.trim()} onClick={reprovarLote}>Confirmar reprovacao</Button></div>
        </div>
      </div>}
    </div>
  )
}
