'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
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
import {
  CreditCard,
  Search,
} from 'lucide-react'

interface OperacaoConsultor {
  id: string
  valor_bruto_total: number
  taxa_desconto: number
  prazo_dias: number
  valor_liquido_desembolso: number
  data_vencimento: string
  status: string
  created_at: string
  cedentes: { razao_social: string; cnpj: string }
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  solicitada: { label: 'Solicitada', variant: 'secondary' },
  em_analise: { label: 'Em Analise', variant: 'outline' },
  em_andamento: { label: 'Em Andamento', variant: 'default' },
  liquidada: { label: 'Liquidada', variant: 'secondary' },
  inadimplente: { label: 'Inadimplente', variant: 'destructive' },
  reprovada: { label: 'Reprovada', variant: 'destructive' },
  cancelada: { label: 'Cancelada', variant: 'outline' },
}

function OperacoesSkeleton() {
  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <Skeleton className="h-8 w-40 mb-2" />
      <Card><CardContent className="pt-4"><Skeleton className="h-11 w-full" /></CardContent></Card>
      <Card><CardContent className="pt-4 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </CardContent></Card>
    </div>
  )
}

export default function OperacoesConsultorPage() {
  const [operacoes, setOperacoes] = useState<OperacaoConsultor[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('operacoes')
        .select('id, valor_bruto_total, taxa_desconto, prazo_dias, valor_liquido_desembolso, data_vencimento, status, created_at, cedentes(razao_social, cnpj)')
        .order('created_at', { ascending: false })

      setOperacoes((data || []) as OperacaoConsultor[])
      setLoading(false)
    }
    load()
  }, [])

  const opsFiltradas = operacoes.filter((op) => {
    if (filtroStatus !== 'todos' && op.status !== filtroStatus) return false
    if (busca) {
      const term = busca.toLowerCase()
      return op.cedentes.razao_social.toLowerCase().includes(term) || op.cedentes.cnpj.includes(term)
    }
    return true
  })

  if (loading) return <OperacoesSkeleton />

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Operacoes</h1>
        <p className="text-muted-foreground">Visualizacao das operacoes dos cedentes da carteira (somente leitura).</p>
      </div>

      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Buscar por cedente..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9 h-11"
              />
            </div>
            <Select value={filtroStatus} onValueChange={(v) => { if (v) setFiltroStatus(v) }}>
              <SelectTrigger className="w-full sm:w-48 h-11">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="em_andamento">Em Andamento</SelectItem>
                <SelectItem value="liquidada">Liquidadas</SelectItem>
                <SelectItem value="solicitada">Solicitadas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {opsFiltradas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CreditCard size={48} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhuma operacao encontrada.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase text-muted-foreground">ID</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground">Cedente</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground text-right">Bruto</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground">Taxa</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground text-right">Liquido</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground">Vencimento</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground">Status</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground">Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opsFiltradas.map((op) => {
                const st = statusConfig[op.status]
                return (
                  <TableRow key={op.id}>
                    <TableCell className="font-mono text-sm text-muted-foreground tabular-nums">{op.id.substring(0, 8)}</TableCell>
                    <TableCell>
                      <p className="text-sm font-medium">{op.cedentes.razao_social}</p>
                      <p className="text-xs text-muted-foreground font-mono">{formatCNPJ(op.cedentes.cnpj)}</p>
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">{formatCurrency(op.valor_bruto_total)}</TableCell>
                    <TableCell className="text-sm tabular-nums">{op.taxa_desconto > 0 ? `${op.taxa_desconto}%` : '—'}</TableCell>
                    <TableCell className="text-right text-sm font-bold tabular-nums text-green-700">{formatCurrency(op.valor_liquido_desembolso)}</TableCell>
                    <TableCell className="text-sm">{formatDate(op.data_vencimento)}</TableCell>
                    <TableCell>
                      <Badge variant={st?.variant || 'outline'}>{st?.label || op.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(op.created_at)}</TableCell>
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
