'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, CheckCircle, Clock, Eye, FileText, Filter, Search, X, XCircle } from 'lucide-react'
import { analisarDocumento, gerarUrlDocumentoGestor } from '@/lib/actions/gestor'
import {
  type FiltrosDocumentosGestor,
  type DocumentoGestorListagemItem,
  type ResultadoDocumentosGestor,
} from '@/lib/documentos/gestor-listagem'
import { buildListUrl } from '@/lib/pagination'
import { formatCNPJ, formatDate } from '@/lib/utils'
import { FilePreviewContent } from '@/components/notas-fiscais/FilePreviewContent'
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

const statusConfig: Record<string, { label: string; className: string; icon: typeof Clock }> = {
  aguardando_envio: { label: 'Aguardando', className: 'bg-muted text-muted-foreground', icon: Clock },
  enviado: { label: 'Enviado', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: FileText },
  em_analise: { label: 'Em analise', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300', icon: AlertCircle },
  aprovado: { label: 'Aprovado', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', icon: CheckCircle },
  reprovado: { label: 'Reprovado', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', icon: XCircle },
}

export function DocumentosGestorListagem({
  filtros,
  resultado,
}: {
  filtros: FiltrosDocumentosGestor
  resultado: ResultadoDocumentosGestor
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const notifications = useNotifications()
  const [isPending, startTransition] = useTransition()
  const [busca, setBusca] = useState(filtros.q)
  const [modal, setModal] = useState<{ doc: DocumentoGestorListagemItem; url: string } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [processing, setProcessing] = useState(false)
  const currentParams = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams])
  const navegar = (updates: Record<string, string | number | null>) => {
    startTransition(() => router.replace(buildListUrl(pathname, currentParams, updates)))
  }

  useEffect(() => {
    if (busca === filtros.q) return
    const timer = window.setTimeout(() => navegar({ q: busca || null, page: 1 }), 350)
    return () => window.clearTimeout(timer)
    // navegar acompanha os parametros atuais e nao deve reiniciar o debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, filtros.q])

  const abrir = async (doc: DocumentoGestorListagemItem) => {
    setProcessing(true)
    const result = await gerarUrlDocumentoGestor(doc.id)
    if (!result?.success || !result.url) {
      notifications.fromActionResult(result)
      setProcessing(false)
      return
    }
    setModal({ doc, url: result.url })
    setMotivo('')
    setProcessing(false)
  }
  const analisar = async (decisao: 'aprovado' | 'reprovado') => {
    if (!modal) return
    if (decisao === 'reprovado' && !motivo.trim()) {
      notifications.error('Motivo obrigatorio para reprovar.')
      return
    }
    setProcessing(true)
    const result = await analisarDocumento(modal.doc.id, decisao, motivo || undefined)
    notifications.fromActionResult(result)
    if (result?.success) {
      setModal(null)
      startTransition(() => router.refresh())
    }
    setProcessing(false)
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Documentos</h1>
        <p className="text-muted-foreground">Fila de documentos para analise.</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Pendentes na pagina', resultado.metricasPagina.pendentes, 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300'],
          ['Aprovados na pagina', resultado.metricasPagina.aprovados, 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'],
          ['Reprovados na pagina', resultado.metricasPagina.reprovados, 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'],
          ['Total no filtro', resultado.pagination.total, 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'],
        ].map(([label, value, tone]) => <div key={String(label)} className={`rounded-xl p-4 ${tone}`}><p className="text-xs font-medium">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{value}</p></div>)}
      </div>

      <Card className="mb-4"><CardContent className="py-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(event) => setBusca(event.target.value)} className="pl-9" placeholder="Buscar por cedente, CNPJ ou tipo..." />
          </div>
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground" />
            <Select value={filtros.status || 'todos'} onValueChange={(value) => navegar({ status: value === 'todos' ? null : value, page: 1 })}>
              <SelectTrigger className="w-full pl-9 sm:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {Object.entries(statusConfig).map(([value, config]) => <SelectItem key={value} value={value}>{config.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Select value={`${filtros.sort}:${filtros.direction}`} onValueChange={(value) => {
            if (!value) return
            const [sort, direction] = value.split(':')
            navegar({ sort, direction, page: 1 })
          }}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at:desc">Mais recentes</SelectItem>
              <SelectItem value="created_at:asc">Mais antigos</SelectItem>
              <SelectItem value="updated_at:desc">Atualizados recentemente</SelectItem>
              <SelectItem value="tipo:asc">Tipo A-Z</SelectItem>
              <SelectItem value="status:asc">Status A-Z</SelectItem>
            </SelectContent>
          </Select>
          {(filtros.q || filtros.status) && <Button variant="ghost" onClick={() => { setBusca(''); navegar({ q: null, status: null, page: 1 }) }}><X size={14} />Limpar</Button>}
        </div>
      </CardContent></Card>

      {resultado.items.length === 0 ? (
        <Card><CardContent className="p-12 text-center"><FileText size={48} className="mx-auto mb-3 text-muted-foreground/30" /><p className="text-muted-foreground">Nenhum documento encontrado.</p></CardContent></Card>
      ) : (
        <Card className={isPending ? 'overflow-hidden py-0 opacity-70' : 'overflow-hidden py-0'}>
          <div className="overflow-x-auto">
            <Table className="min-w-[850px]">
              <TableHeader><TableRow>
                <TableHead className="px-4 py-3 text-xs uppercase">Cedente</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Tipo</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Versao atual</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Ultima analise</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Status</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Data</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Acoes</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {resultado.items.map((doc) => {
                  const status = statusConfig[doc.status] || statusConfig.aguardando_envio
                  const StatusIcon = status.icon
                  return <TableRow key={doc.id}>
                    <TableCell className="w-[220px] max-w-[220px] px-4 py-3"><ListNameCell name={doc.cedente.nome} subline={formatCNPJ(doc.cedente.cnpj)} /></TableCell>
                    <TableCell className="px-4 py-3">{doc.nome}</TableCell>
                    <TableCell className="px-4 py-3 tabular-nums">v{doc.versaoAtual.numero}</TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground">{doc.ultimaAnalise ? formatDate(doc.ultimaAnalise.analisadoEm) : '—'}</TableCell>
                    <TableCell className="px-4 py-3"><Badge className={status.className}><StatusIcon size={12} />{status.label}</Badge></TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground">{formatDate(doc.criadoEm)}</TableCell>
                    <TableCell className="px-4 py-3">
                      {doc.possuiArquivo && <Button variant="ghost" size="sm" disabled={processing} onClick={() => abrir(doc)}><Eye size={14} />{['enviado', 'em_analise'].includes(doc.status) ? 'Analisar' : 'Ver'}</Button>}
                    </TableCell>
                  </TableRow>
                })}
              </TableBody>
            </Table>
          </div>
          <ListPagination className="border-t px-4 py-3" pagination={resultado.pagination} disabled={isPending} onPageChange={(page) => navegar({ page })} onPageSizeChange={(pageSize) => navegar({ pageSize, page: 1 })} />
        </Card>
      )}

      {modal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b p-4"><div><h3 className="font-semibold">{modal.doc.nome} — v{modal.doc.versaoAtual.numero}</h3><p className="text-sm text-muted-foreground">{modal.doc.cedente.nome}</p></div><Button variant="ghost" size="icon" onClick={() => setModal(null)}><X size={20} /></Button></div>
          <div className="flex-1 overflow-auto p-4"><FilePreviewContent url={modal.url} title={modal.doc.nome} className="h-[500px]" /></div>
          {['enviado', 'em_analise'].includes(modal.doc.status) && <div className="space-y-3 border-t p-4">
            <div className="flex gap-3"><Button disabled={processing} onClick={() => analisar('aprovado')} className="flex-1 bg-green-600 text-white hover:bg-green-700">Aprovar</Button><Button disabled={processing} onClick={() => analisar('reprovado')} variant="destructive" className="flex-1">Reprovar</Button></div>
            <div><Label htmlFor="motivo-documento">Motivo da reprovacao</Label><textarea id="motivo-documento" className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm" rows={2} value={motivo} onChange={(event) => setMotivo(event.target.value)} /></div>
          </div>}
        </div>
      </div>}
    </div>
  )
}
