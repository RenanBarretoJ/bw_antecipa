'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  Search,
  Filter,
  Eye,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  XCircle,
  Upload,
  Banknote,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

const statusConfig: Record<string, { label: string; icon: typeof CheckCircle; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  rascunho: { label: 'Rascunho', icon: FileText, variant: 'secondary', className: '' },
  submetida: { label: 'Submetida', icon: Upload, variant: 'default', className: 'bg-blue-100 text-blue-700 border-transparent' },
  em_analise: { label: 'Em Analise', icon: AlertCircle, variant: 'default', className: 'bg-yellow-100 text-yellow-700 border-transparent' },
  aprovada: { label: 'Aprovada', icon: CheckCircle, variant: 'default', className: 'bg-green-100 text-green-700 border-transparent' },
  em_antecipacao: { label: 'Em Antecipacao', icon: Banknote, variant: 'default', className: 'bg-purple-100 text-purple-700 border-transparent' },
  liquidada: { label: 'Liquidada', icon: CheckCircle, variant: 'default', className: 'bg-emerald-100 text-emerald-700 border-transparent' },
  cancelada: { label: 'Cancelada/Reprovada', icon: XCircle, variant: 'destructive', className: '' },
}

export default function NotasFiscaisGestorPage() {
  const [nfs, setNfs] = useState<NfGestorRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<string>('submetida')
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('notas_fiscais')
        .select('id, numero_nf, cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, data_emissao, data_vencimento, status, created_at, cedente_id')
        .order('created_at', { ascending: false })

      setNfs((data || []) as NfGestorRecord[])
      setLoading(false)
    }
    load()
  }, [])

  const nfsFiltradas = nfs.filter((nf) => {
    if (filtroStatus !== 'todos' && nf.status !== filtroStatus) return false
    if (busca) {
      const term = busca.toLowerCase()
      return (
        nf.numero_nf.toLowerCase().includes(term) ||
        nf.razao_social_emitente.toLowerCase().includes(term) ||
        nf.cnpj_emitente.includes(term) ||
        nf.razao_social_destinatario.toLowerCase().includes(term) ||
        nf.cnpj_destinatario.includes(term)
      )
    }
    return true
  })

  const pendentes = nfs.filter((n) => n.status === 'submetida' || n.status === 'em_analise').length
  const aprovadas = nfs.filter((n) => n.status === 'aprovada').length
  const valorTotal = nfs.filter((n) => n.status !== 'cancelada').reduce((acc, n) => acc + n.valor_bruto, 0)

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Notas Fiscais</h1>
        <p className="text-muted-foreground">Analise e gerencie as NFs dos cedentes.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-yellow-50 rounded-xl p-4">
          <p className="text-xs font-medium text-yellow-600">Pendentes de Analise</p>
          <p className="text-2xl font-bold text-yellow-700 mt-1 tabular-nums">{pendentes}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-xs font-medium text-green-600">Aprovadas</p>
          <p className="text-2xl font-bold text-green-700 mt-1 tabular-nums">{aprovadas}</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs font-medium text-blue-600">Total de NFs</p>
          <p className="text-2xl font-bold text-blue-700 mt-1 tabular-nums">{nfs.length}</p>
        </div>
        <div className="bg-purple-50 rounded-xl p-4">
          <p className="text-xs font-medium text-purple-600">Valor Total</p>
          <p className="text-2xl font-bold text-purple-700 mt-1 tabular-nums">{formatCurrency(valorTotal)}</p>
        </div>
      </div>

      {/* Filtros */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Buscar por numero, CNPJ ou razao social..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="h-11 pl-9"
              />
            </div>
            <div className="relative flex items-center gap-2">
              <Filter size={16} className="text-muted-foreground shrink-0" />
              <Select
                value={filtroStatus}
                onValueChange={(v) => { if (v) setFiltroStatus(v) }}
              >
                <SelectTrigger className="h-11 min-w-[200px]">
                  <SelectValue placeholder="Filtrar por status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="submetida">Submetidas (pendentes)</SelectItem>
                  <SelectItem value="em_analise">Em Analise</SelectItem>
                  <SelectItem value="aprovada">Aprovadas</SelectItem>
                  <SelectItem value="em_antecipacao">Em Antecipacao</SelectItem>
                  <SelectItem value="liquidada">Liquidadas</SelectItem>
                  <SelectItem value="cancelada">Canceladas/Reprovadas</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
      ) : nfsFiltradas.length === 0 ? (
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
                <TableHead className="px-4 py-3 text-xs uppercase">NF</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Cedente (Emitente)</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Sacado (Destinatario)</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Valor</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Vencimento</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Status</TableHead>
                <TableHead className="px-4 py-3 text-xs uppercase">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nfsFiltradas.map((nf) => {
                const status = statusConfig[nf.status] || statusConfig.rascunho
                const StatusIcon = status.icon
                return (
                  <TableRow key={nf.id}>
                    <TableCell className="px-4 py-3 font-medium text-foreground">{nf.numero_nf || '—'}</TableCell>
                    <TableCell className="px-4 py-3">
                      <p className="text-sm text-foreground">{nf.razao_social_emitente}</p>
                      <p className="text-xs text-muted-foreground">{formatCNPJ(nf.cnpj_emitente)}</p>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <p className="text-sm text-foreground">{nf.razao_social_destinatario || '—'}</p>
                      <p className="text-xs text-muted-foreground">
                        {nf.cnpj_destinatario ? formatCNPJ(nf.cnpj_destinatario) : '—'}
                      </p>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm font-medium text-foreground tabular-nums">
                      {nf.valor_bruto > 0 ? formatCurrency(nf.valor_bruto) : '—'}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {nf.data_vencimento ? formatDate(nf.data_vencimento) : '—'}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge
                        variant={status.variant}
                        className={status.className}
                      >
                        <StatusIcon size={12} />
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3">
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
    </div>
  )
}
