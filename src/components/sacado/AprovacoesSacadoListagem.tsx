'use client'

import { Fragment, useEffect, useMemo, useState, useTransition } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  CheckSquare,
  ChevronDown,
  Eye,
  Filter,
  Loader2,
  Search,
  Square,
  X,
  XCircle,
} from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { aprovarCessao, aprovarCessaoLote, contestarCessao } from '@/lib/actions/sacado'
import { obterUrlArquivoNotaSacado } from '@/lib/actions/sacado-portal'
import type {
  FiltrosAprovacoesSacado,
  ResultadoAprovacoesSacado,
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
import { Label } from '@/components/ui/label'

export function AprovacoesSacadoListagem({
  filtros,
  resultado,
}: {
  filtros: FiltrosAprovacoesSacado
  resultado: ResultadoAprovacoesSacado
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const notifications = useNotifications()
  const [isPending, startTransition] = useTransition()
  const [busca, setBusca] = useState(filtros.q)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [processing, setProcessing] = useState<string | null>(null)
  const [processandoLote, setProcessandoLote] = useState(false)
  const [contestando, setContestando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [showFiltros, setShowFiltros] = useState(false)
  const [preview, setPreview] = useState<{ titulo: string; url: string } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null)
  const currentParams = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams])

  const navegar = (updates: Record<string, string | number | null>) => {
    setSelecionadas(new Set())
    startTransition(() => router.replace(buildListUrl(pathname, currentParams, updates)))
  }

  useEffect(() => {
    if (busca === filtros.q) return
    const timer = window.setTimeout(() => navegar({ q: busca || null, page: 1 }), 350)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, filtros.q])

  const todasSelecionadas = resultado.items.length > 0
    && resultado.items.every((item) => selecionadas.has(item.notaFiscalId))
  const toggleTodas = () => setSelecionadas(
    todasSelecionadas
      ? new Set()
      : new Set(resultado.items.map((item) => item.notaFiscalId)),
  )
  const toggleItem = (id: string) => setSelecionadas((atual) => {
    const proximo = new Set(atual)
    if (proximo.has(id)) proximo.delete(id)
    else proximo.add(id)
    return proximo
  })

  const aprovar = async (id: string) => {
    setProcessing(id)
    const result = await aprovarCessao(id)
    notifications.fromActionResult(result)
    if (result?.success) {
      setSelecionadas((atual) => {
        const proximo = new Set(atual)
        proximo.delete(id)
        return proximo
      })
      startTransition(() => router.refresh())
    }
    setProcessing(null)
  }

  const aprovarLote = async () => {
    setProcessandoLote(true)
    const result = await aprovarCessaoLote(Array.from(selecionadas))
    notifications.fromActionResult(result)
    if (result?.success) {
      setSelecionadas(new Set())
      startTransition(() => router.refresh())
    }
    setProcessandoLote(false)
  }

  const contestar = async (id: string) => {
    if (!motivo.trim()) {
      notifications.error('Informe o motivo da contestacao.')
      return
    }
    setProcessing(id)
    const result = await contestarCessao(id, motivo)
    notifications.fromActionResult(result)
    if (result?.success) {
      setContestando(null)
      setMotivo('')
      startTransition(() => router.refresh())
    }
    setProcessing(null)
  }

  const abrirPreview = async (id: string, numero: string) => {
    setLoadingPreview(id)
    const result = await obterUrlArquivoNotaSacado(id)
    if (!result.success || !result.url) {
      notifications.error(result.message || 'Nao foi possivel abrir o arquivo da NF.')
    } else {
      setPreview({ titulo: `NF ${numero}`, url: result.url })
    }
    setLoadingPreview(null)
  }

  const valorSelecionado = resultado.items
    .filter((item) => selecionadas.has(item.notaFiscalId))
    .reduce((total, item) => total + item.valor, 0)
  const temFiltros = Boolean(
    filtros.q
    || filtros.cedenteId
    || filtros.vencimentoDe
    || filtros.vencimentoAte
    || filtros.valorMinimo !== null
    || filtros.valorMaximo !== null,
  )

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Aprovacao de Cessao</h1>
        <p className="text-muted-foreground">Aprove ou conteste as cessoes de credito das NFs emitidas contra voce.</p>
      </div>

      {resultado.pagination.total === 0 && !temFiltros ? (
        <Card><CardContent className="p-12 text-center">
          <CheckCircle size={48} className="mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground">Nenhuma cessao pendente de aprovacao.</p>
        </CardContent></Card>
      ) : (
        <>
          <Card className="mb-4"><CardContent className="space-y-3 p-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por NF, cedente ou CNPJ..."
                  value={busca}
                  onChange={(event) => setBusca(event.target.value)}
                  className="h-10 pl-9"
                />
              </div>
              <select
                value={filtros.cedenteId || ''}
                onChange={(event) => navegar({ cedente: event.target.value || null, page: 1 })}
                className="min-w-[210px] rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">Todos os cedentes</option>
                {resultado.cedentes.map((item) => (
                  <option key={item.id} value={item.id}>{item.nome}</option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFiltros((atual) => !atual)}
                className={`h-10 gap-2 ${temFiltros ? 'border-primary text-primary' : ''}`}
              >
                <Filter size={14} /> Filtros
                <ChevronDown size={14} className={showFiltros ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </Button>
            </div>
            {showFiltros && (
              <div className="grid grid-cols-2 gap-3 border-t pt-3 md:grid-cols-4">
                <div><Label className="text-xs text-muted-foreground">Vencimento de</Label>
                  <Input type="date" value={filtros.vencimentoDe} onChange={(event) => navegar({ vencimentoDe: event.target.value || null, page: 1 })} className="h-9" />
                </div>
                <div><Label className="text-xs text-muted-foreground">Vencimento ate</Label>
                  <Input type="date" value={filtros.vencimentoAte} onChange={(event) => navegar({ vencimentoAte: event.target.value || null, page: 1 })} className="h-9" />
                </div>
                <div><Label className="text-xs text-muted-foreground">Valor minimo (R$)</Label>
                  <Input type="number" min="0" value={filtros.valorMinimo ?? ''} onChange={(event) => navegar({ valorMinimo: event.target.value || null, page: 1 })} className="h-9" />
                </div>
                <div><Label className="text-xs text-muted-foreground">Valor maximo (R$)</Label>
                  <Input type="number" min="0" value={filtros.valorMaximo ?? ''} onChange={(event) => navegar({ valorMaximo: event.target.value || null, page: 1 })} className="h-9" />
                </div>
              </div>
            )}
            {temFiltros && (
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => {
                  setBusca('')
                  navegar({
                    q: null,
                    cedente: null,
                    vencimentoDe: null,
                    vencimentoAte: null,
                    valorMinimo: null,
                    valorMaximo: null,
                    page: 1,
                  })
                }}>Limpar filtros</Button>
              </div>
            )}
          </CardContent></Card>

          {selecionadas.size > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
              <div className="text-sm font-medium">
                <span className="text-primary">{selecionadas.size}</span> NF(s) selecionada(s)
                <span className="font-normal text-muted-foreground"> — Total: {formatCurrency(valorSelecionado)}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelecionadas(new Set())}>Desmarcar</Button>
                <Button size="sm" disabled={processandoLote} onClick={aprovarLote} className="bg-green-600 text-white hover:bg-green-700">
                  {processandoLote ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  Aprovar {selecionadas.size} NF(s)
                </Button>
              </div>
            </div>
          )}

          <Card className={isPending ? 'overflow-hidden opacity-70' : 'overflow-hidden'}>
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-sm">
                <thead><tr className="border-b bg-muted/50">
                  <th className="w-10 px-4 py-3"><button onClick={toggleTodas} aria-label="Selecionar todas da pagina">{todasSelecionadas ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} />}</button></th>
                  <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">NF</th>
                  <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Cedente</th>
                  <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Valor</th>
                  <th className="px-4 py-3 text-left text-xs uppercase text-muted-foreground">Vencimento</th>
                  <th className="px-4 py-3 text-right text-xs uppercase text-muted-foreground">Acoes</th>
                </tr></thead>
                <tbody className="divide-y">
                  {resultado.items.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Nenhuma NF encontrada com os filtros aplicados.</td></tr>
                  ) : resultado.items.map((item) => {
                    const id = item.notaFiscalId
                    const isContestando = contestando === id
                    const isProcessing = processing === id
                    return <Fragment key={id}>
                      <tr className={selecionadas.has(id) ? 'bg-primary/5' : 'hover:bg-muted/30'}>
                        <td className="px-4 py-3"><button onClick={() => toggleItem(id)} aria-label={`Selecionar NF ${item.numero}`}>{selecionadas.has(id) ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} />}</button></td>
                        <td className="px-4 py-3"><p className="font-medium">{item.numero}</p><Badge className="mt-1 bg-purple-100 text-purple-700">Cessao ativa</Badge></td>
                        <td className="w-[220px] max-w-[220px] px-4 py-3"><ListNameCell name={item.cedente.nome} subline={formatCNPJ(item.cedente.cnpj)} /></td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums">{formatCurrency(item.valor)}</td>
                        <td className="whitespace-nowrap px-4 py-3">{item.vencimentoEm ? formatDate(item.vencimentoEm) : '—'}</td>
                        <td className="px-4 py-3"><div className="flex items-center justify-end gap-1">
                          {item.possuiArquivo && <Button variant="ghost" size="icon" title="Ver NF" disabled={loadingPreview === id} onClick={() => abrirPreview(id, item.numero)}>{loadingPreview === id ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}</Button>}
                          <Button size="sm" disabled={isProcessing || processandoLote} onClick={() => aprovar(id)} className="bg-green-600 text-white hover:bg-green-700">{isProcessing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Aprovar</Button>
                          <Button size="sm" variant="destructive" disabled={isProcessing || processandoLote} onClick={() => setContestando(isContestando ? null : id)}><XCircle size={12} /> Contestar</Button>
                        </div></td>
                      </tr>
                      {isContestando && <tr className="bg-red-50 dark:bg-red-950/10"><td colSpan={6} className="px-4 py-3">
                        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-red-800 dark:text-red-300"><AlertTriangle size={15} />Contestar NF {item.numero}</div>
                        <textarea value={motivo} onChange={(event) => setMotivo(event.target.value)} rows={2} className="mb-2 w-full rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Descreva o motivo da contestacao (obrigatorio)..." />
                        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => { setContestando(null); setMotivo('') }}>Cancelar</Button><Button variant="destructive" size="sm" disabled={isProcessing} onClick={() => contestar(id)}>Confirmar Contestacao</Button></div>
                      </td></tr>}
                    </Fragment>
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t px-4 py-3 text-xs text-muted-foreground">
              {resultado.items.length} de {resultado.pagination.total} NF(s) · Valor da pagina: {formatCurrency(resultado.valorPagina)}
            </div>
            <ListPagination
              className="border-t px-4 py-3"
              pagination={resultado.pagination}
              disabled={isPending}
              onPageChange={(page) => navegar({ page })}
              onPageSizeChange={(pageSize) => navegar({ pageSize, page: 1 })}
            />
          </Card>
        </>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold">{preview.titulo}</h3>
              <Button variant="ghost" size="icon" onClick={() => setPreview(null)}><X size={20} /></Button>
            </div>
            <div className="flex-1 overflow-auto p-4"><FilePreviewContent url={preview.url} title={preview.titulo} className="h-[600px]" /></div>
          </div>
        </div>
      )}
    </div>
  )
}
