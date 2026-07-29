'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Eye, Loader2, Receipt, Search, X } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { obterUrlArquivoNotaSacado } from '@/lib/actions/sacado-portal'
import type {
  FiltrosNfsSacado,
  ResultadoNfsSacado,
} from '@/lib/sacado/portal-listagens'
import { buildListUrl } from '@/lib/pagination'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'
import { FilePreviewContent } from '@/components/notas-fiscais/FilePreviewContent'
import { useNotifications } from '@/components/notifications/notification-provider'
import { ListNameCell } from '@/components/data-display/primitives'
import { ListPagination } from '@/components/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const statusConfig: Record<string, { label: string; className: string }> = {
  submetida: { label: 'Submetida', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  em_analise: { label: 'Em analise', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  aprovada: { label: 'Aprovada', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  em_antecipacao: { label: 'Cedida (Em Antecipacao)', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  aceita: { label: 'Antecipada', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  contestada: { label: 'Contestada', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  liquidada: { label: 'Liquidada', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  cancelada: { label: 'Cancelada', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
}

export function NotasFiscaisSacadoListagem({
  filtros,
  resultado,
}: {
  filtros: FiltrosNfsSacado
  resultado: ResultadoNfsSacado
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const notifications = useNotifications()
  const [isPending, startTransition] = useTransition()
  const [busca, setBusca] = useState(filtros.q)
  const [preview, setPreview] = useState<{ titulo: string; url: string } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null)
  const currentParams = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams])

  const navegar = (updates: Record<string, string | number | null>) => {
    startTransition(() => router.replace(buildListUrl(pathname, currentParams, updates)))
  }

  useEffect(() => {
    if (busca === filtros.q) return
    const timer = window.setTimeout(() => navegar({ q: busca || null, page: 1 }), 350)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, filtros.q])

  const abrirPreview = async (id: string, numero: string) => {
    setLoadingPreview(id)
    const result = await obterUrlArquivoNotaSacado(id)
    if (!result.success || !result.url) {
      notifications.error(result.message || 'Nao foi possivel abrir o arquivo original da NF.')
    } else {
      setPreview({ titulo: `NF ${numero}`, url: result.url })
    }
    setLoadingPreview(null)
  }

  const hoje = new Date().toISOString().slice(0, 10)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">NFs Recebidas</h1>
        <p className="text-muted-foreground">Notas fiscais emitidas contra voce.</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Total NFs', resultado.indicadores.total, 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'],
          ['Cedidas', resultado.indicadores.cedidas, 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300'],
          ['Liquidadas', resultado.indicadores.liquidadas, 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'],
          ['Vencidas', resultado.indicadores.vencidas, 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className={`rounded-xl p-4 ${tone}`}>
            <p className="text-xs font-medium">{label}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <Card className="mb-4"><CardContent className="py-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              className="h-10 pl-9"
              placeholder="Buscar por numero, cedente ou CNPJ..."
            />
          </div>
          <Select
            value={filtros.status || 'todos'}
            onValueChange={(value) => navegar({ status: value === 'todos' ? null : value, page: 1 })}
          >
            <SelectTrigger className="h-10 w-[210px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              {Object.entries(statusConfig).map(([value, config]) => (
                <SelectItem key={value} value={value}>{config.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={`${filtros.sort}:${filtros.direction}`}
            onValueChange={(value) => {
              if (!value) return
              const [sort, direction] = value.split(':')
              navegar({ sort, direction, page: 1 })
            }}
          >
            <SelectTrigger className="h-10 w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at:desc">Mais recentes</SelectItem>
              <SelectItem value="data_vencimento:asc">Vencimento mais proximo</SelectItem>
              <SelectItem value="valor_bruto:desc">Maior valor</SelectItem>
              <SelectItem value="numero_nf:asc">Numero da NF</SelectItem>
            </SelectContent>
          </Select>
          {(filtros.q || filtros.status) && (
            <Button variant="ghost" onClick={() => { setBusca(''); navegar({ q: null, status: null, page: 1 }) }}>
              <X size={14} /> Limpar
            </Button>
          )}
        </div>
      </CardContent></Card>

      {resultado.items.length === 0 ? (
        <Card><CardContent className="p-12 text-center">
          <Receipt size={48} className="mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground">Nenhuma NF encontrada.</p>
        </CardContent></Card>
      ) : (
        <Card className={isPending ? 'overflow-hidden opacity-70' : 'overflow-hidden'}>
          <div className="overflow-x-auto">
            <Table className="min-w-[920px]">
              <TableHeader><TableRow>
                <TableHead className="px-4 py-3 text-xs uppercase">NF</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Cedente (Emitente)</TableHead>
                <TableHead className="px-4 py-3 text-right text-xs uppercase">Valor</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Emissao</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Vencimento</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Status</TableHead>
                <TableHead className="px-4 py-3" />
              </TableRow></TableHeader>
              <TableBody>
                {resultado.items.map((item) => {
                  const status = statusConfig[item.status]
                  const vencido = Boolean(
                    item.vencimentoEm
                    && item.vencimentoEm < hoje
                    && ['em_andamento', 'inadimplente'].includes(item.operacao?.status || ''),
                  )
                  return <TableRow key={item.id} className={vencido ? 'bg-red-50/50 dark:bg-red-950/10' : undefined}>
                    <TableCell className="px-4 py-3 font-medium">{item.numero}</TableCell>
                    <TableCell className="w-[220px] max-w-[220px] px-4 py-3">
                      <ListNameCell name={item.cedente.nome} subline={formatCNPJ(item.cedente.cnpj)} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums">{formatCurrency(item.valor)}</TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3 text-muted-foreground">{item.emissaoEm ? formatDate(item.emissaoEm) : '—'}</TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3">
                      <span className={vencido ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                        {item.vencimentoEm ? formatDate(item.vencimentoEm) : '—'}
                      </span>
                      {vencido && <span className="ml-1 text-xs text-destructive">(vencido)</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3">
                      <Badge className={status?.className || ''}>{status?.label || item.status}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-4 py-3">
                      {item.possuiArquivo && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={loadingPreview === item.id}
                          onClick={() => abrirPreview(item.id, item.numero)}
                        >
                          {loadingPreview === item.id ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                          Ver NF
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                })}
              </TableBody>
            </Table>
          </div>
          <ListPagination
            className="border-t px-4 py-3"
            pagination={resultado.pagination}
            disabled={isPending}
            onPageChange={(page) => navegar({ page })}
            onPageSizeChange={(pageSize) => navegar({ pageSize, page: 1 })}
          />
        </Card>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold">{preview.titulo}</h3>
              <Button variant="ghost" size="icon" onClick={() => setPreview(null)}><X size={20} /></Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <FilePreviewContent url={preview.url} title={preview.titulo} className="h-[600px]" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
