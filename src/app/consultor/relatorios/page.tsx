'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
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
  BarChart3,
  DollarSign,
  TrendingUp,
  Users,
  Calendar,
} from 'lucide-react'

interface CarteiraCedente {
  cedente_id: string
  comissao_percentual: number
  cedentes: { razao_social: string; cnpj: string; status: string }
}

interface OperacaoResumo {
  id: string
  cedente_id: string
  valor_bruto_total: number
  valor_liquido_desembolso: number
  status: string
  created_at: string
  cedentes: { razao_social: string }
}

function RelatoriosSkeleton() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div><Skeleton className="h-8 w-56 mb-2" /><Skeleton className="h-4 w-72" /></div>
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}><CardContent className="pt-5"><Skeleton className="h-8 w-24 mb-1" /><Skeleton className="h-4 w-16" /></CardContent></Card>
        ))}
      </div>
      <Card><CardContent className="pt-4 space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </CardContent></Card>
    </div>
  )
}

export default function RelatoriosConsultorPage() {
  const [carteira, setCarteira] = useState<CarteiraCedente[]>([])
  const [operacoes, setOperacoes] = useState<OperacaoResumo[]>([])
  const [loading, setLoading] = useState(true)
  const [mesSelected, setMesSelected] = useState(new Date().toISOString().substring(0, 7))

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const [carteiraRes, opsRes] = await Promise.all([
        supabase.from('consultor_cedentes')
          .select('cedente_id, comissao_percentual, cedentes(razao_social, cnpj, status)'),
        supabase.from('operacoes')
          .select('id, cedente_id, valor_bruto_total, valor_liquido_desembolso, status, created_at, cedentes(razao_social)')
          .in('status', ['em_andamento', 'liquidada'])
          .order('created_at', { ascending: false }),
      ])

      setCarteira((carteiraRes.data || []) as CarteiraCedente[])
      setOperacoes((opsRes.data || []) as OperacaoResumo[])
      setLoading(false)
    }
    load()
  }, [])

  // Filtrar por mes
  const opsMes = operacoes.filter((o) => o.created_at.substring(0, 7) === mesSelected)
  const volumeMes = opsMes.reduce((acc, o) => acc + o.valor_bruto_total, 0)

  // Comissao por cedente
  const comissaoPorCedente = carteira.map((c) => {
    const opsDosCedente = opsMes.filter((o) => o.cedente_id === c.cedente_id)
    const volumeCedente = opsDosCedente.reduce((acc, o) => acc + o.valor_liquido_desembolso, 0)
    const comissao = volumeCedente * c.comissao_percentual / 100
    const opsTotal = operacoes.filter((o) => o.cedente_id === c.cedente_id)
    const volumeTotal = opsTotal.reduce((acc, o) => acc + o.valor_bruto_total, 0)

    return {
      cedente: c.cedentes.razao_social,
      cnpj: c.cedentes.cnpj,
      status: c.cedentes.status,
      percentual: c.comissao_percentual,
      volumeMes: volumeCedente,
      comissaoMes: comissao,
      opsNoMes: opsDosCedente.length,
      volumeTotal,
    }
  }).sort((a, b) => b.comissaoMes - a.comissaoMes)

  const comissaoTotal = comissaoPorCedente.reduce((acc, c) => acc + c.comissaoMes, 0)
  const volumeAcumulado = operacoes.reduce((acc, o) => acc + o.valor_bruto_total, 0)

  // Gerar lista de meses disponiveis
  const mesesDisponiveis = [...new Set(operacoes.map((o) => o.created_at.substring(0, 7)))].sort().reverse()
  if (!mesesDisponiveis.includes(mesSelected)) {
    mesesDisponiveis.unshift(mesSelected)
  }

  if (loading) return <RelatoriosSkeleton />

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Relatorios e Comissoes</h1>
          <p className="text-muted-foreground">Performance da carteira e comissoes por periodo.</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-muted-foreground" />
          <Select value={mesSelected} onValueChange={(v) => { if (v) setMesSelected(v) }}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mesesDisponiveis.map((m) => (
                <SelectItem key={m} value={m}>
                  {new Date(m + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs do periodo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-blue-100 dark:bg-blue-500/20 rounded-lg"><BarChart3 size={18} className="text-blue-600" /></div>
              <span className="text-xs text-muted-foreground">Volume no Mes</span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-blue-700">{formatCurrency(volumeMes)}</p>
            <p className="text-xs text-muted-foreground">{opsMes.length} operacao(es)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-green-100 dark:bg-green-500/20 rounded-lg"><DollarSign size={18} className="text-green-600" /></div>
              <span className="text-xs text-muted-foreground">Comissao no Mes</span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-green-700">{formatCurrency(comissaoTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-purple-100 dark:bg-purple-500/20 rounded-lg"><TrendingUp size={18} className="text-purple-600" /></div>
              <span className="text-xs text-muted-foreground">Volume Acumulado</span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-purple-700">{formatCurrency(volumeAcumulado)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-amber-100 dark:bg-amber-500/20 rounded-lg"><Users size={18} className="text-amber-600" /></div>
              <span className="text-xs text-muted-foreground">Cedentes Ativos</span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-amber-700">{carteira.filter((c) => c.cedentes.status === 'ativo').length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabela de comissoes por cedente */}
      <Card className="mb-6">
        <CardHeader className="border-b">
          <CardTitle className="text-lg">Comissoes por Cedente</CardTitle>
        </CardHeader>
        {comissaoPorCedente.length === 0 ? (
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Nenhum cedente na carteira.</p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase text-muted-foreground">Cedente</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground">Status</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground text-right">Vol. Mes</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground">Ops Mes</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground">%</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground text-right">Comissao</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground text-right">Vol. Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comissaoPorCedente.map((c) => (
                <TableRow key={c.cnpj}>
                  <TableCell>
                    <p className="text-sm font-medium">{c.cedente}</p>
                    <p className="text-xs text-muted-foreground font-mono">{formatCNPJ(c.cnpj)}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.status === 'ativo' ? 'default' : 'outline'}>{c.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium tabular-nums">{formatCurrency(c.volumeMes)}</TableCell>
                  <TableCell className="text-sm tabular-nums">{c.opsNoMes}</TableCell>
                  <TableCell className="text-sm font-medium tabular-nums">{c.percentual}%</TableCell>
                  <TableCell className="text-right text-sm font-bold tabular-nums text-green-700">{formatCurrency(c.comissaoMes)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{formatCurrency(c.volumeTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={5} className="text-sm font-bold text-foreground">Total</TableCell>
                <TableCell className="text-right text-lg font-bold tabular-nums text-green-700">{formatCurrency(comissaoTotal)}</TableCell>
                <TableCell className="text-right text-sm font-bold tabular-nums">{formatCurrency(volumeAcumulado)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </Card>

      {/* Nota */}
      <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-300">
        <p className="font-medium mb-1">Nota</p>
        <p>Os valores de comissao sao estimados com base nas operacoes em andamento e liquidadas. Os valores finais sao confirmados pelo gestor.</p>
      </div>
    </div>
  )
}
