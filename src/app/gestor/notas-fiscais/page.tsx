'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import { aprovarNFsLote, reprovarNFsLote } from '@/lib/actions/nota-fiscal'
import Link from 'next/link'
import {
  Search,
  Filter,
  Eye,
  FileText,
  CheckCircle,
  AlertCircle,
  XCircle,
  Upload,
  Banknote,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  X,
  Loader2,
  Wrench,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface NfGestorRecord {
  id: string
  numero_nf: string
  cnpj_emitente: string
  razao_social_emitente: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  data_emissao: string
  data_vencimento: string
  status: string
  created_at: string
  cedente_id: string
}

type SortField = keyof Pick<NfGestorRecord, 'numero_nf' | 'valor_bruto' | 'data_emissao' | 'data_vencimento' | 'status'>

const NF_SELECT = 'id, numero_nf, cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, data_emissao, data_vencimento, status, created_at, cedente_id'

const statusConfig: Record<string, { label: string; icon: typeof CheckCircle; className: string }> = {
  rascunho:       { label: 'Rascunho',              icon: FileText,    className: '' },
  submetida:      { label: 'Submetida',              icon: Upload,      className: 'bg-blue-100 text-blue-700 border-transparent' },
  em_analise:     { label: 'Em Analise',             icon: AlertCircle, className: 'bg-yellow-100 text-yellow-700 border-transparent' },
  aprovada:       { label: 'Validada',               icon: CheckCircle, className: 'bg-green-100 text-green-700 border-transparent' },
  em_antecipacao: { label: 'Em Antecipacao',         icon: Banknote,    className: 'bg-purple-100 text-purple-700 border-transparent' },
  aceita:         { label: 'Aprovado pelo Sacado',   icon: CheckCircle, className: 'bg-green-100 text-green-700 border-transparent' },
  contestada:     { label: 'Contestada',             icon: AlertCircle, className: 'bg-orange-100 text-orange-700 border-transparent' },
  liquidada:      { label: 'Liquidada',              icon: CheckCircle, className: 'bg-emerald-100 text-emerald-700 border-transparent' },
  cancelada:      { label: 'Cancelada/Reprovada',    icon: XCircle,     className: 'bg-red-100 text-red-700 border-transparent' },
  requer_ajuste:  { label: 'Requer Ajuste',          icon: Wrench,      className: 'bg-orange-100 text-orange-700 border-transparent' },
}

export default function NotasFiscaisGestorPage() {
  const [nfs, setNfs] = useState<NfGestorRecord[]>([])
  const [loading, setLoading] = useState(true)

  // Filtros
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [filtroCedente, setFiltroCedente] = useState('todos')
  const [filtroVencDe, setFiltroVencDe] = useState('')
  const [filtroVencAte, setFiltroVencAte] = useState('')
  const [busca, setBusca] = useState('')

  // Ordenação
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Seleção em lote
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const selectAllRef = useRef<HTMLInputElement>(null)

  // Reprovar em lote
  const [showReprovarModal, setShowReprovarModal] = useState(false)
  const [motivoLote, setMotivoLote] = useState('')
  const [loadingLote, setLoadingLote] = useState(false)
  const [loteMessage, setLoteMessage] = useState('')

  const reloadNfs = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('notas_fiscais')
      .select(NF_SELECT)
      .order('created_at', { ascending: false })
    setNfs((data || []) as NfGestorRecord[])
  }, [])

  useEffect(() => {
    reloadNfs().then(() => setLoading(false))
  }, [reloadNfs])

  // Limpar seleção quando qualquer filtro muda
  useEffect(() => {
    setSelecionadas(new Set())
  }, [filtroStatus, filtroCedente, filtroVencDe, filtroVencAte, busca])

  const cedentesUnicos = useMemo(() => {
    const map = new Map<string, string>()
    for (const nf of nfs) {
      if (!map.has(nf.cedente_id)) map.set(nf.cedente_id, nf.razao_social_emitente)
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [nfs])

  const nfsFiltradas = useMemo(() => {
    return nfs.filter((nf) => {
      if (filtroStatus !== 'todos' && nf.status !== filtroStatus) return false
      if (filtroCedente !== 'todos' && nf.cedente_id !== filtroCedente) return false
      const venc = (nf.data_vencimento || '').substring(0, 10)
      if (filtroVencDe && venc && venc < filtroVencDe) return false
      if (filtroVencAte && venc && venc > filtroVencAte) return false
      if (busca) {
        const t = busca.toLowerCase()
        return (
          nf.numero_nf.toLowerCase().includes(t) ||
          nf.razao_social_emitente.toLowerCase().includes(t) ||
          nf.cnpj_emitente.includes(t) ||
          nf.razao_social_destinatario.toLowerCase().includes(t) ||
          nf.cnpj_destinatario.includes(t)
        )
      }
      return true
    })
  }, [nfs, filtroStatus, filtroCedente, filtroVencDe, filtroVencAte, busca])

  const nfsOrdenadas = useMemo(() => {
    if (!sortField) return nfsFiltradas
    return [...nfsFiltradas].sort((a, b) => {
      const va = a[sortField]
      const vb = b[sortField]
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [nfsFiltradas, sortField, sortDir])

  // Cards: reflete seleção quando há itens marcados, senão reflete o filtro
  const fonteCards = useMemo(
    () => selecionadas.size > 0 ? nfsOrdenadas.filter((nf) => selecionadas.has(nf.id)) : nfsOrdenadas,
    [selecionadas, nfsOrdenadas],
  )
  const cardPendentes = fonteCards.filter((n) => n.status === 'submetida' || n.status === 'em_analise').length
  const cardAprovadas = fonteCards.filter((n) => n.status === 'aprovada').length
  const cardTotal = fonteCards.length
  const cardValor = fonteCards.filter((n) => n.status !== 'cancelada').reduce((s, n) => s + n.valor_bruto, 0)
  const cardLegenda = selecionadas.size > 0
    ? `${selecionadas.size} NF${selecionadas.size > 1 ? 's' : ''} selecionada${selecionadas.size > 1 ? 's' : ''}`
    : `${nfsOrdenadas.length} NF${nfsOrdenadas.length !== 1 ? 's' : ''} no filtro`

  // Checkbox "selecionar todas"
  useEffect(() => {
    if (!selectAllRef.current) return
    const all = nfsOrdenadas.length > 0 && nfsOrdenadas.every((nf) => selecionadas.has(nf.id))
    const some = nfsOrdenadas.some((nf) => selecionadas.has(nf.id))
    selectAllRef.current.checked = all
    selectAllRef.current.indeterminate = some && !all
  }, [nfsOrdenadas, selecionadas])

  const toggleSelectAll = () => {
    const all = nfsOrdenadas.every((nf) => selecionadas.has(nf.id))
    setSelecionadas(all ? new Set() : new Set(nfsOrdenadas.map((nf) => nf.id)))
  }

  const toggleSelecionar = (id: string) => {
    setSelecionadas((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const temFiltrosAtivos = filtroStatus !== 'todos' || filtroCedente !== 'todos' || !!filtroVencDe || !!filtroVencAte || !!busca

  const limparFiltros = () => {
    setFiltroStatus('todos')
    setFiltroCedente('todos')
    setFiltroVencDe('')
    setFiltroVencAte('')
    setBusca('')
  }

  const elegiveisNaSel = useMemo(
    () => [...selecionadas].filter((id) => {
      const nf = nfs.find((n) => n.id === id)
      return nf && (nf.status === 'submetida' || nf.status === 'em_analise')
    }).length,
    [selecionadas, nfs],
  )

  const handleAprovarLote = async () => {
    setLoadingLote(true)
    setLoteMessage('')
    const result = await aprovarNFsLote([...selecionadas])
    setLoteMessage(result?.message || '')
    if (result?.success) {
      setSelecionadas(new Set())
      await reloadNfs()
    }
    setLoadingLote(false)
  }

  const handleReprovarLote = async () => {
    if (!motivoLote.trim()) return
    setLoadingLote(true)
    setLoteMessage('')
    const result = await reprovarNFsLote([...selecionadas], motivoLote)
    setLoteMessage(result?.message || '')
    if (result?.success) {
      setSelecionadas(new Set())
      setShowReprovarModal(false)
      setMotivoLote('')
      await reloadNfs()
    }
    setLoadingLote(false)
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronsUpDown size={11} className="opacity-30 shrink-0" />
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="text-primary shrink-0" />
      : <ChevronDown size={11} className="text-primary shrink-0" />
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Notas Fiscais</h1>
        <p className="text-muted-foreground">Analise e gerencie as NFs dos cedentes.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
        <div className="bg-yellow-50 rounded-xl p-4">
          <p className="text-xs font-medium text-yellow-600">Pendentes de Analise</p>
          <p className="text-2xl font-bold text-yellow-700 mt-1 tabular-nums">{cardPendentes}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-xs font-medium text-green-600">Aprovadas</p>
          <p className="text-2xl font-bold text-green-700 mt-1 tabular-nums">{cardAprovadas}</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs font-medium text-blue-600">Total de NFs</p>
          <p className="text-2xl font-bold text-blue-700 mt-1 tabular-nums">{cardTotal}</p>
        </div>
        <div className="bg-purple-50 rounded-xl p-4">
          <p className="text-xs font-medium text-purple-600">Valor Total</p>
          <p className="text-2xl font-bold text-purple-700 mt-1 tabular-nums">{formatCurrency(cardValor)}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-5 pl-1">{cardLegenda}</p>

      {/* Filtros */}
      <Card className="mb-4">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por numero, CNPJ ou razao social..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="h-9 pl-9"
              />
            </div>

            <Select value={filtroStatus} onValueChange={(v) => { if (v) setFiltroStatus(v) }}>
              <SelectTrigger className="h-9 w-[200px] gap-1.5">
                <span className="text-xs text-muted-foreground shrink-0">Status:</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="submetida">Submetidas</SelectItem>
                <SelectItem value="em_analise">Em Analise</SelectItem>
                <SelectItem value="aprovada">Validadas</SelectItem>
                <SelectItem value="em_antecipacao">Em Antecipacao</SelectItem>
                <SelectItem value="aceita">Aceitas pelo Sacado</SelectItem>
                <SelectItem value="contestada">Contestadas</SelectItem>
                <SelectItem value="requer_ajuste">Requer Ajuste</SelectItem>
                <SelectItem value="liquidada">Liquidadas</SelectItem>
                <SelectItem value="cancelada">Canceladas/Reprovadas</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filtroCedente} onValueChange={(v) => { if (v) setFiltroCedente(v) }}>
              <SelectTrigger className="h-9 w-[220px] gap-1.5">
                <span className="text-xs text-muted-foreground shrink-0">Cedente:</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {cedentesUnicos.map(([id, nome]) => (
                  <SelectItem key={id} value={id}>{nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground shrink-0">Venc.</span>
              <Input
                type="date"
                value={filtroVencDe}
                onChange={(e) => setFiltroVencDe(e.target.value)}
                className="h-9 w-[136px]"
              />
              <span className="text-xs text-muted-foreground shrink-0">—</span>
              <Input
                type="date"
                value={filtroVencAte}
                onChange={(e) => setFiltroVencAte(e.target.value)}
                className="h-9 w-[136px]"
              />
            </div>

            {temFiltrosAtivos && (
              <Button variant="ghost" size="sm" onClick={limparFiltros} className="gap-1 text-muted-foreground h-9 shrink-0">
                <X size={13} />
                Limpar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      {loading ? (
        <Card>
          <CardContent className="pt-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : nfsOrdenadas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText size={48} className="mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">Nenhuma NF encontrada.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4 py-3 w-10">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="rounded border-border cursor-pointer accent-primary"
                    onChange={toggleSelectAll}
                    aria-label="Selecionar todas"
                  />
                </TableHead>
                <TableHead
                  className="px-4 py-3 text-xs uppercase cursor-pointer select-none hover:bg-muted/50 transition-colors"
                  onClick={() => toggleSort('numero_nf')}
                >
                  <div className="flex items-center gap-1">NF <SortIcon field="numero_nf" /></div>
                </TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Cedente (Emitente)</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Sacado (Destinatario)</TableHead>
                <TableHead
                  className="px-4 py-3 text-xs uppercase cursor-pointer select-none hover:bg-muted/50 transition-colors"
                  onClick={() => toggleSort('valor_bruto')}
                >
                  <div className="flex items-center gap-1">Valor <SortIcon field="valor_bruto" /></div>
                </TableHead>
                <TableHead
                  className="px-4 py-3 text-xs uppercase cursor-pointer select-none hover:bg-muted/50 transition-colors"
                  onClick={() => toggleSort('data_emissao')}
                >
                  <div className="flex items-center gap-1">Emissao <SortIcon field="data_emissao" /></div>
                </TableHead>
                <TableHead
                  className="px-4 py-3 text-xs uppercase cursor-pointer select-none hover:bg-muted/50 transition-colors"
                  onClick={() => toggleSort('data_vencimento')}
                >
                  <div className="flex items-center gap-1">Vencimento <SortIcon field="data_vencimento" /></div>
                </TableHead>
                <TableHead
                  className="px-4 py-3 text-xs uppercase cursor-pointer select-none hover:bg-muted/50 transition-colors"
                  onClick={() => toggleSort('status')}
                >
                  <div className="flex items-center gap-1">Status <SortIcon field="status" /></div>
                </TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nfsOrdenadas.map((nf) => {
                const cfg = statusConfig[nf.status] || statusConfig.rascunho
                const StatusIcon = cfg.icon
                const marcada = selecionadas.has(nf.id)
                return (
                  <TableRow
                    key={nf.id}
                    className={marcada ? 'bg-primary/5' : undefined}
                    onClick={() => toggleSelecionar(nf.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <TableCell className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={() => toggleSelecionar(nf.id)}
                        className="rounded border-border cursor-pointer accent-primary"
                        aria-label={`Selecionar NF ${nf.numero_nf}`}
                      />
                    </TableCell>
                    <TableCell className="px-4 py-3 font-medium text-foreground">{nf.numero_nf || '—'}</TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="max-w-[160px]">
                        <p className="text-sm text-foreground truncate" title={nf.razao_social_emitente}>
                          {nf.razao_social_emitente}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatCNPJ(nf.cnpj_emitente)}</p>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="max-w-[160px]">
                        <p className="text-sm text-foreground truncate" title={nf.razao_social_destinatario || undefined}>
                          {nf.razao_social_destinatario || '—'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {nf.cnpj_destinatario ? formatCNPJ(nf.cnpj_destinatario) : '—'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm font-medium text-foreground tabular-nums">
                      {nf.valor_bruto > 0 ? formatCurrency(nf.valor_bruto) : '—'}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {nf.data_emissao ? formatDate(nf.data_emissao) : '—'}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {nf.data_vencimento ? formatDate(nf.data_vencimento) : '—'}
                    </TableCell>
                    <TableCell className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <Badge className={cfg.className}>
                        <StatusIcon size={12} />
                        {cfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <Link href={`/gestor/notas-fiscais/${nf.id}`}>
                        <Button variant="ghost" size="sm" className="gap-1 text-sm">
                          <Eye size={14} />
                          Analisar
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Barra de ações em lote */}
      {selecionadas.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-background border border-border rounded-2xl shadow-xl px-5 py-3">
          <span className="text-sm font-medium text-foreground whitespace-nowrap">
            {selecionadas.size} NF{selecionadas.size > 1 ? 's' : ''} selecionada{selecionadas.size > 1 ? 's' : ''}
            {elegiveisNaSel < selecionadas.size && (
              <span className="text-muted-foreground font-normal ml-1">({elegiveisNaSel} elegível{elegiveisNaSel !== 1 ? 'eis' : ''})</span>
            )}
          </span>
          <div className="w-px h-5 bg-border" />
          {loteMessage && (
            <span className={`text-sm ${loteMessage.includes('sucesso') ? 'text-green-600' : 'text-destructive'}`}>
              {loteMessage}
            </span>
          )}
          <Button
            size="sm"
            className="gap-1 bg-green-600 hover:bg-green-700 text-white"
            disabled={loadingLote || elegiveisNaSel === 0}
            onClick={handleAprovarLote}
          >
            {loadingLote ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
            Aprovar em lote
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="gap-1"
            disabled={loadingLote || elegiveisNaSel === 0}
            onClick={() => { setMotivoLote(''); setLoteMessage(''); setShowReprovarModal(true) }}
          >
            <XCircle size={13} />
            Reprovar em lote
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => { setSelecionadas(new Set()); setLoteMessage('') }}
          >
            <X size={14} />
          </Button>
        </div>
      )}

      {/* Modal reprovar em lote */}
      {showReprovarModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-xl shadow-xl max-w-md w-full border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <XCircle size={16} className="text-destructive" />
                Reprovar {elegiveisNaSel} NF{elegiveisNaSel !== 1 ? 's' : ''} em lote
              </h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { setShowReprovarModal(false); setMotivoLote('') }}
              >
                <X size={18} />
              </Button>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="text-sm">Motivo da reprovacao</Label>
                <textarea
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  rows={3}
                  placeholder="Informe o motivo que sera aplicado a todas as NFs selecionadas..."
                  value={motivoLote}
                  onChange={(e) => setMotivoLote(e.target.value)}
                />
              </div>
              {loteMessage && (
                <p className="text-sm text-destructive">{loteMessage}</p>
              )}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setShowReprovarModal(false); setMotivoLote('') }}
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={loadingLote || !motivoLote.trim()}
                  onClick={handleReprovarLote}
                >
                  {loadingLote ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                  Confirmar reprovacao
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
