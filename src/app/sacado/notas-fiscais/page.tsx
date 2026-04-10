'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import { buckets } from '@/lib/storage'
import { Receipt, Search, Eye, X, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface NfSacado {
  id: string
  numero_nf: string
  cnpj_emitente: string
  razao_social_emitente: string
  valor_bruto: number
  data_emissao: string
  data_vencimento: string
  status: string
  arquivo_url: string | null
}

const statusConfig: Record<string, { label: string; className: string }> = {
  aprovada: { label: 'Aprovada', className: 'bg-green-100 text-green-700 border-green-200' },
  em_antecipacao: { label: 'Cedida (Em Antecipacao)', className: 'bg-purple-100 text-purple-700 border-purple-200' },
  aceita: { label: 'Aceita', className: 'bg-green-100 text-green-700 border-green-200' },
  contestada: { label: 'Contestada', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  liquidada: { label: 'Liquidada', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  cancelada: { label: 'Cancelada', className: 'bg-red-100 text-red-700 border-red-200' },
}

function LoadingSkeleton() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="space-y-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-16 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}

export default function NfsRecebidasSacadoPage() {
  const [nfs, setNfs] = useState<NfSacado[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [preview, setPreview] = useState<{ nf: NfSacado; url: string } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('notas_fiscais')
        .select('id, numero_nf, cnpj_emitente, razao_social_emitente, valor_bruto, data_emissao, data_vencimento, status, arquivo_url')
        .order('data_vencimento', { ascending: true })

      setNfs((data || []) as NfSacado[])
      setLoading(false)
    }
    load()
  }, [])

  const openPreview = async (nf: NfSacado) => {
    if (!nf.arquivo_url) return
    setLoadingPreview(true)
    const supabase = createClient()
    const { data } = await supabase.storage
      .from(buckets.notasFiscais)
      .createSignedUrl(nf.arquivo_url, 3600)
    setPreview({ nf, url: data?.signedUrl || '' })
    setLoadingPreview(false)
  }

  const nfsFiltradas = nfs.filter((nf) => {
    if (filtroStatus !== 'todos' && nf.status !== filtroStatus) return false
    if (busca) {
      const term = busca.toLowerCase()
      return nf.numero_nf.includes(term) || nf.razao_social_emitente.toLowerCase().includes(term) || nf.cnpj_emitente.includes(term)
    }
    return true
  })

  const hoje = new Date().toISOString().split('T')[0]

  if (loading) return <LoadingSkeleton />

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">NFs Recebidas</h1>
        <p className="text-muted-foreground">Notas fiscais emitidas contra voce.</p>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs font-medium text-blue-600">Total NFs</p>
          <p className="text-2xl font-bold text-blue-700 tabular-nums">{nfs.length}</p>
        </div>
        <div className="bg-purple-50 rounded-xl p-4">
          <p className="text-xs font-medium text-purple-600">Cedidas</p>
          <p className="text-2xl font-bold text-purple-700 tabular-nums">{nfs.filter((n) => n.status === 'em_antecipacao').length}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-xs font-medium text-green-600">Liquidadas</p>
          <p className="text-2xl font-bold text-green-700 tabular-nums">{nfs.filter((n) => n.status === 'liquidada').length}</p>
        </div>
        <div className="bg-red-50 rounded-xl p-4">
          <p className="text-xs font-medium text-red-600">Vencidas</p>
          <p className="text-2xl font-bold text-red-700 tabular-nums">{nfs.filter((n) => n.status === 'em_antecipacao' && n.data_vencimento < hoje).length}</p>
        </div>
      </div>

      {/* Filtros */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Buscar por numero, cedente ou CNPJ..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="h-11 pl-9"
              />
            </div>
            <select
              value={filtroStatus}
              onChange={(e) => { if (e.target.value) setFiltroStatus(e.target.value) }}
              className="border border-input rounded-lg px-3 py-2 text-sm bg-background text-foreground"
            >
              <option value="todos">Todos</option>
              <option value="em_antecipacao">Cedidas (a pagar)</option>
              <option value="liquidada">Liquidadas</option>
              <option value="aprovada">Aprovadas</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      {nfsFiltradas.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Receipt size={48} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhuma NF encontrada.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase">NF</TableHead>
                <TableHead className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Cedente (Emitente)</TableHead>
                <TableHead className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase text-right">Valor</TableHead>
                <TableHead className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Emissao</TableHead>
                <TableHead className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Vencimento</TableHead>
                <TableHead className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Status</TableHead>
                <TableHead className="px-4 py-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {nfsFiltradas.map((nf) => {
                const st = statusConfig[nf.status]
                const vencido = nf.status === 'em_antecipacao' && nf.data_vencimento < hoje
                return (
                  <TableRow key={nf.id} className={vencido ? 'bg-red-50/50' : ''}>
                    <TableCell className="px-4 py-3 font-medium text-foreground">{nf.numero_nf}</TableCell>
                    <TableCell className="px-4 py-3">
                      <p className="text-sm text-foreground">{nf.razao_social_emitente}</p>
                      <p className="text-xs text-muted-foreground">{formatCNPJ(nf.cnpj_emitente)}</p>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right text-sm font-bold text-foreground tabular-nums">{formatCurrency(nf.valor_bruto)}</TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground tabular-nums">{formatDate(nf.data_emissao)}</TableCell>
                    <TableCell className="px-4 py-3">
                      <span className={`text-sm font-medium tabular-nums ${vencido ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {formatDate(nf.data_vencimento)}
                      </span>
                      {vencido && <span className="ml-1 text-xs text-destructive">(vencido)</span>}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge className={st?.className || 'bg-gray-100 text-gray-600'}>
                        {st?.label || nf.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      {nf.arquivo_url && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openPreview(nf)}
                          disabled={loadingPreview}
                          className="gap-1 text-muted-foreground hover:text-foreground"
                        >
                          {loadingPreview ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                          Ver NF
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Modal de preview */}
      {preview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-border">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="font-semibold text-foreground">NF {preview.nf.numero_nf}</h3>
                <p className="text-xs text-muted-foreground">{preview.nf.razao_social_emitente} — {formatCurrency(preview.nf.valor_bruto)}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setPreview(null)}>
                <X size={20} />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {preview.url ? (
                preview.nf.arquivo_url?.toLowerCase().endsWith('.pdf') ? (
                  <iframe src={preview.url} className="w-full h-[600px] border rounded" />
                ) : (
                  <img src={preview.url} alt={`NF ${preview.nf.numero_nf}`} className="max-w-full mx-auto rounded" />
                )
              ) : (
                <p className="text-muted-foreground text-center py-10">Nao foi possivel carregar o arquivo.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
