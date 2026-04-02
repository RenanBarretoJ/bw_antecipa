'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, parseLocalDate } from '@/lib/utils'
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Calendar,
  AlertTriangle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface OperacaoResumo {
  id: string
  cedente_id: string
  valor_bruto_total: number
  valor_liquido_desembolso: number
  taxa_desconto: number
  status: string
  created_at: string
  data_vencimento: string
  cedentes: { razao_social: string; cnpj: string }
}

interface CedenteResumo {
  id: string
  razao_social: string
  cnpj: string
  status: string
}

export default function RelatoriosGestorPage() {
  const [operacoes, setOperacoes] = useState<OperacaoResumo[]>([])
  const [cedentes, setCedentes] = useState<CedenteResumo[]>([])
  const [loading, setLoading] = useState(true)
  const [mesSelected, setMesSelected] = useState(new Date().toISOString().substring(0, 7))

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const [opsRes, cedsRes] = await Promise.all([
        supabase.from('operacoes')
          .select('id, cedente_id, valor_bruto_total, valor_liquido_desembolso, taxa_desconto, status, created_at, data_vencimento, cedentes(razao_social, cnpj)')
          .order('created_at', { ascending: false }),
        supabase.from('cedentes')
          .select('id, razao_social, cnpj, status'),
      ])

      setOperacoes((opsRes.data || []) as OperacaoResumo[])
      setCedentes((cedsRes.data || []) as CedenteResumo[])
      setLoading(false)
    }
    load()
  }, [])

  // Filtrar por mes
  const opsMes = operacoes.filter((o) => o.created_at.substring(0, 7) === mesSelected)
  const opsValidas = opsMes.filter((o) => !['cancelada', 'reprovada'].includes(o.status))

  // KPIs do mes
  const volumeBrutoMes = opsValidas.reduce((a, o) => a + o.valor_bruto_total, 0)
  const volumeLiquidoMes = opsValidas.reduce((a, o) => a + o.valor_liquido_desembolso, 0)
  const receitaMes = volumeBrutoMes - volumeLiquidoMes
  const opsAtivasMes = opsValidas.filter((o) => o.status === 'em_andamento').length
  const opsLiquidadasMes = opsValidas.filter((o) => o.status === 'liquidada').length
  const opsInadimplentesMes = opsValidas.filter((o) => o.status === 'inadimplente').length
  const taxaMedia = opsValidas.length > 0
    ? opsValidas.reduce((a, o) => a + o.taxa_desconto, 0) / opsValidas.length
    : 0

  // Por cedente
  const volumePorCedente = cedentes
    .filter((c) => c.status === 'ativo')
    .map((c) => {
      const opsDosCedente = operacoes.filter((o) => o.cedente_id === c.id && !['cancelada', 'reprovada'].includes(o.status))
      const opsMesCedente = opsDosCedente.filter((o) => o.created_at.substring(0, 7) === mesSelected)
      return {
        razao_social: c.razao_social,
        cnpj: c.cnpj,
        volumeTotal: opsDosCedente.reduce((a, o) => a + o.valor_bruto_total, 0),
        volumeMes: opsMesCedente.reduce((a, o) => a + o.valor_bruto_total, 0),
        opsTotal: opsDosCedente.length,
        opsMes: opsMesCedente.length,
        inadimplentes: opsDosCedente.filter((o) => o.status === 'inadimplente').length,
      }
    })
    .sort((a, b) => b.volumeTotal - a.volumeTotal)

  // Meses disponiveis
  const mesesDisponiveis = [...new Set(operacoes.map((o) => o.created_at.substring(0, 7)))].sort().reverse()
  if (!mesesDisponiveis.includes(mesSelected)) mesesDisponiveis.unshift(mesSelected)

  // Totais gerais
  const volumeTotalGeral = operacoes
    .filter((o) => !['cancelada', 'reprovada'].includes(o.status))
    .reduce((a, o) => a + o.valor_bruto_total, 0)

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Relatorios</h1>
          <p className="text-muted-foreground">Visao gerencial de operacoes e performance.</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-muted-foreground" />
          <Select value={mesSelected} onValueChange={(v) => { if (v) setMesSelected(v) }}>
            <SelectTrigger className="h-9 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mesesDisponiveis.map((m) => (
                <SelectItem key={m} value={m}>
                  {parseLocalDate(m + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-blue-100 rounded-lg"><BarChart3 size={18} className="text-blue-600" /></div>
              <span className="text-xs text-muted-foreground">Volume Bruto (Mes)</span>
            </div>
            <p className="text-2xl font-bold text-blue-700 tabular-nums">{formatCurrency(volumeBrutoMes)}</p>
            <p className="text-xs text-muted-foreground tabular-nums">{opsValidas.length} operacao(es)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-green-100 rounded-lg"><DollarSign size={18} className="text-green-600" /></div>
              <span className="text-xs text-muted-foreground">Receita (Mes)</span>
            </div>
            <p className="text-2xl font-bold text-green-700 tabular-nums">{formatCurrency(receitaMes)}</p>
            <p className="text-xs text-muted-foreground tabular-nums">Taxa media: {taxaMedia.toFixed(2)}% a.m.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-purple-100 rounded-lg"><TrendingUp size={18} className="text-purple-600" /></div>
              <span className="text-xs text-muted-foreground">Volume Total Acumulado</span>
            </div>
            <p className="text-2xl font-bold text-purple-700 tabular-nums">{formatCurrency(volumeTotalGeral)}</p>
            <p className="text-xs text-muted-foreground tabular-nums">{operacoes.filter((o) => !['cancelada', 'reprovada'].includes(o.status)).length} operacoes</p>
          </CardContent>
        </Card>
        <Card className={opsInadimplentesMes > 0 ? 'ring-red-200 bg-red-50' : ''}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-red-100 rounded-lg"><AlertTriangle size={18} className="text-red-600" /></div>
              <span className="text-xs text-muted-foreground">Inadimplencia</span>
            </div>
            <p className="text-2xl font-bold text-destructive tabular-nums">{opsInadimplentesMes}</p>
            <p className="text-xs text-muted-foreground tabular-nums">{opsLiquidadasMes} liquidadas no mes</p>
          </CardContent>
        </Card>
      </div>

      {/* Resumo por status */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Solicitadas', count: opsMes.filter((o) => o.status === 'solicitada').length, color: 'bg-blue-50 text-blue-700' },
          { label: 'Em Andamento', count: opsAtivasMes, color: 'bg-purple-50 text-purple-700' },
          { label: 'Liquidadas', count: opsLiquidadasMes, color: 'bg-green-50 text-green-700' },
          { label: 'Reprovadas', count: opsMes.filter((o) => o.status === 'reprovada').length, color: 'bg-red-50 text-red-700' },
          { label: 'Canceladas', count: opsMes.filter((o) => o.status === 'cancelada').length, color: 'bg-gray-50 text-gray-700' },
        ].map((item) => (
          <div key={item.label} className={`rounded-xl p-3 text-center ${item.color}`}>
            <p className="text-2xl font-bold tabular-nums">{item.count}</p>
            <p className="text-xs">{item.label}</p>
          </div>
        ))}
      </div>

      {/* Tabela por cedente */}
      <Card className="overflow-hidden py-0">
        <CardHeader className="border-b border-border px-6 py-4">
          <CardTitle>Volume por Cedente</CardTitle>
        </CardHeader>
        {volumePorCedente.length === 0 ? (
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">Nenhum cedente ativo.</p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase px-4 py-3">Cedente</TableHead>
                <TableHead className="text-xs uppercase px-4 py-3 text-right">Vol. Mes</TableHead>
                <TableHead className="text-xs uppercase px-4 py-3">Ops Mes</TableHead>
                <TableHead className="text-xs uppercase px-4 py-3 text-right">Vol. Total</TableHead>
                <TableHead className="text-xs uppercase px-4 py-3">Ops Total</TableHead>
                <TableHead className="text-xs uppercase px-4 py-3">Inadimp.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {volumePorCedente.map((c) => (
                <TableRow key={c.cnpj}>
                  <TableCell className="px-4 py-3">
                    <p className="text-sm font-medium text-foreground">{c.razao_social}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">{formatCNPJ(c.cnpj)}</p>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right text-sm font-medium tabular-nums">{formatCurrency(c.volumeMes)}</TableCell>
                  <TableCell className="px-4 py-3 text-sm tabular-nums">{c.opsMes}</TableCell>
                  <TableCell className="px-4 py-3 text-right text-sm font-bold tabular-nums">{formatCurrency(c.volumeTotal)}</TableCell>
                  <TableCell className="px-4 py-3 text-sm tabular-nums">{c.opsTotal}</TableCell>
                  <TableCell className="px-4 py-3">
                    {c.inadimplentes > 0 ? (
                      <Badge className="rounded-full text-xs font-medium bg-red-100 text-red-700 tabular-nums">{c.inadimplentes}</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground tabular-nums">0</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="px-4 py-3 font-bold text-sm">Total</TableCell>
                <TableCell className="px-4 py-3 text-right font-bold text-sm tabular-nums">{formatCurrency(volumeBrutoMes)}</TableCell>
                <TableCell className="px-4 py-3 font-bold text-sm tabular-nums">{opsValidas.length}</TableCell>
                <TableCell className="px-4 py-3 text-right font-bold text-sm tabular-nums">{formatCurrency(volumeTotalGeral)}</TableCell>
                <TableCell className="px-4 py-3 font-bold text-sm tabular-nums">{operacoes.filter((o) => !['cancelada', 'reprovada'].includes(o.status)).length}</TableCell>
                <TableCell className="px-4 py-3"></TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </Card>
    </div>
  )
}
