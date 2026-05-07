'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  Eye,
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle,
  Banknote,
  Filter,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface OperacaoGestor {
  id: string
  valor_bruto_total: number
  taxa_desconto: number
  prazo_dias: number
  valor_liquido_desembolso: number
  data_vencimento: string
  status: string
  created_at: string
  aprovado_em: string | null
  cedentes: {
    razao_social: string
    cnpj: string
  }
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link'

const statusConfig: Record<string, { label: string; variant: BadgeVariant; className: string; icon: typeof CheckCircle }> = {
  solicitada: { label: 'Solicitada', variant: 'secondary', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: Clock },
  em_analise: { label: 'Em Analise', variant: 'secondary', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', icon: AlertCircle },
  aprovada: { label: 'Aprovada', variant: 'secondary', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle },
  em_andamento: { label: 'Em Andamento', variant: 'secondary', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', icon: Banknote },
  liquidada: { label: 'Liquidada', variant: 'secondary', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: CheckCircle },
  inadimplente: { label: 'Inadimplente', variant: 'destructive', className: '', icon: AlertCircle },
  reprovada: { label: 'Reprovada', variant: 'destructive', className: '', icon: XCircle },
  cancelada: { label: 'Cancelada', variant: 'outline', className: 'text-muted-foreground', icon: XCircle },
}

function TableSkeleton() {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-16" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export default function OperacoesGestorPage() {
  const [ops, setOps] = useState<OperacaoGestor[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [busca, setBusca] = useState('')
  const [valorMin, setValorMin] = useState('')
  const [valorMax, setValorMax] = useState('')
  const [aprovadoDe, setAprovadoDe] = useState('')
  const [aprovadoAte, setAprovadoAte] = useState('')
  const [filtrosExpandidos, setFiltrosExpandidos] = useState(false)
  const [ordenacao, setOrdenacao] = useState<{ campo: string; direcao: 'asc' | 'desc' }>({ campo: 'created_at', direcao: 'desc' })

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('operacoes')
        .select('id, valor_bruto_total, taxa_desconto, prazo_dias, valor_liquido_desembolso, data_vencimento, status, created_at, aprovado_em, cedentes(razao_social, cnpj)')
        .order('created_at', { ascending: false })

      setOps((data || []) as OperacaoGestor[])
      setLoading(false)
    }
    load()
  }, [])

  const handleOrdenar = (campo: string) => {
    setOrdenacao((prev) => ({
      campo,
      direcao: prev.campo === campo && prev.direcao === 'asc' ? 'desc' : 'asc',
    }))
  }

  const temFiltrosExtras = valorMin || valorMax || aprovadoDe || aprovadoAte

  const limparFiltrosExtras = () => {
    setValorMin(''); setValorMax('')
    setAprovadoDe(''); setAprovadoAte('')
  }

  const opsFiltradas = ops
    .filter((op) => {
      if (filtroStatus !== 'todos' && op.status !== filtroStatus) return false
      if (busca) {
        const term = busca.toLowerCase()
        if (
          !op.cedentes.razao_social.toLowerCase().includes(term) &&
          !op.cedentes.cnpj.includes(term) &&
          !op.id.includes(term)
        ) return false
      }
      if (valorMin && op.valor_bruto_total < parseFloat(valorMin)) return false
      if (valorMax && op.valor_bruto_total > parseFloat(valorMax)) return false
      if (aprovadoDe && (!op.aprovado_em || op.aprovado_em < aprovadoDe)) return false
      if (aprovadoAte && (!op.aprovado_em || op.aprovado_em > aprovadoAte + 'T23:59:59')) return false
      return true
    })
    .sort((a, b) => {
      const { campo, direcao } = ordenacao
      let aVal: string | number = a.created_at
      let bVal: string | number = b.created_at
      if (campo === 'valor_bruto_total') { aVal = a.valor_bruto_total; bVal = b.valor_bruto_total }
      else if (campo === 'taxa_desconto') { aVal = a.taxa_desconto; bVal = b.taxa_desconto }
      else if (campo === 'prazo_dias') { aVal = a.prazo_dias; bVal = b.prazo_dias }
      else if (campo === 'valor_liquido_desembolso') { aVal = a.valor_liquido_desembolso; bVal = b.valor_liquido_desembolso }
      else if (campo === 'status') { aVal = a.status; bVal = b.status }
      else if (campo === 'aprovado_em') { aVal = a.aprovado_em ?? ''; bVal = b.aprovado_em ?? '' }
      if (aVal < bVal) return direcao === 'asc' ? -1 : 1
      if (aVal > bVal) return direcao === 'asc' ? 1 : -1
      return 0
    })

  const pendentes = ops.filter((o) => o.status === 'solicitada' || o.status === 'em_analise').length
  const volumeAtivo = ops
    .filter((o) => o.status === 'em_andamento')
    .reduce((acc, o) => acc + o.valor_liquido_desembolso, 0)

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Operacoes</h1>
        <p className="text-muted-foreground">Gerencie as solicitacoes de antecipacao.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-4">
          <p className="text-xs font-medium text-yellow-600 dark:text-yellow-400">Pendentes</p>
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300 tabular-nums">{pendentes}</p>
        </div>
        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-4">
          <p className="text-xs font-medium text-purple-600 dark:text-purple-400">Em Andamento</p>
          <p className="text-2xl font-bold text-purple-700 dark:text-purple-300 tabular-nums">{ops.filter((o) => o.status === 'em_andamento').length}</p>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4">
          <p className="text-xs font-medium text-green-600 dark:text-green-400">Volume Ativo</p>
          <p className="text-2xl font-bold text-green-700 dark:text-green-300 tabular-nums">{formatCurrency(volumeAtivo)}</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Total Operacoes</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-300 tabular-nums">{ops.length}</p>
        </div>
      </div>

      {/* Filtros */}
      <Card className="mb-4">
        <CardContent className="py-4 space-y-3">
          {/* Linha 1: busca + status + expandir */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Buscar por cedente, CNPJ ou ID..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <div className="relative flex items-center gap-2">
              <Filter size={16} className="text-muted-foreground shrink-0" />
              <Select value={filtroStatus} onValueChange={(v) => { if (v) setFiltroStatus(v) }}>
                <SelectTrigger className="h-9 min-w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="solicitada">Solicitadas (pendentes)</SelectItem>
                  <SelectItem value="aprovada">Aprovadas</SelectItem>
                  <SelectItem value="em_andamento">Em Andamento</SelectItem>
                  <SelectItem value="liquidada">Liquidadas</SelectItem>
                  <SelectItem value="inadimplente">Inadimplentes</SelectItem>
                  <SelectItem value="reprovada">Reprovadas</SelectItem>
                  <SelectItem value="cancelada">Canceladas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFiltrosExpandidos((v) => !v)}
              className={`gap-1 shrink-0 ${temFiltrosExtras ? 'border-primary text-primary' : ''}`}
            >
              <Filter size={14} />
              Mais filtros
              {temFiltrosExtras && <span className="ml-1 w-2 h-2 rounded-full bg-primary inline-block" />}
              {filtrosExpandidos ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </Button>
          </div>

          {/* Linha 2: filtros avançados */}
          {filtrosExpandidos && (
            <div className="flex flex-wrap gap-4 pt-2 border-t border-border items-end">
              {/* Valor Bruto */}
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">Valor Bruto — mínimo</p>
                  <Input
                    type="number"
                    placeholder="0,00"
                    value={valorMin}
                    onChange={(e) => setValorMin(e.target.value)}
                    className="h-8 text-sm w-32"
                    min={0}
                  />
                </div>
                <span className="text-xs text-muted-foreground mb-2">—</span>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">máximo</p>
                  <Input
                    type="number"
                    placeholder="0,00"
                    value={valorMax}
                    onChange={(e) => setValorMax(e.target.value)}
                    className="h-8 text-sm w-32"
                    min={0}
                  />
                </div>
              </div>

              <div className="w-px h-10 bg-border self-end mb-0.5 hidden sm:block" />

              {/* Data Aprovação */}
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">Data Aprovação — de</p>
                  <Input
                    type="date"
                    value={aprovadoDe}
                    onChange={(e) => setAprovadoDe(e.target.value)}
                    className="h-8 text-sm w-36"
                  />
                </div>
                <span className="text-xs text-muted-foreground mb-2">até</span>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium invisible">até</p>
                  <Input
                    type="date"
                    value={aprovadoAte}
                    onChange={(e) => setAprovadoAte(e.target.value)}
                    className="h-8 text-sm w-36"
                  />
                </div>
              </div>

              {temFiltrosExtras && (
                <Button variant="ghost" size="xs" onClick={limparFiltrosExtras} className="text-muted-foreground self-end mb-0.5">
                  <X size={13} className="mr-1" /> Limpar
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabela */}
      {loading ? (
        <TableSkeleton />
      ) : opsFiltradas.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Banknote size={48} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhuma operacao encontrada.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {(() => {
                      const SortIcon = ({ campo }: { campo: string }) => {
                        if (ordenacao.campo !== campo) return <ArrowUpDown size={12} className="ml-1 text-muted-foreground/50 inline" />
                        return ordenacao.direcao === 'asc'
                          ? <ArrowUp size={12} className="ml-1 text-primary inline" />
                          : <ArrowDown size={12} className="ml-1 text-primary inline" />
                      }
                      const Th = ({ campo, children }: { campo: string; children: React.ReactNode }) => (
                        <th
                          className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap"
                          onClick={() => handleOrdenar(campo)}
                        >
                          {children}<SortIcon campo={campo} />
                        </th>
                      )
                      return (
                        <>
                          <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">ID</th>
                          <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Cedente</th>
                          <Th campo="valor_bruto_total">Valor Bruto</Th>
                          <Th campo="taxa_desconto">Taxa</Th>
                          <Th campo="prazo_dias">Prazo</Th>
                          <Th campo="valor_liquido_desembolso">Liquido</Th>
                          <Th campo="status">Status</Th>
                          <Th campo="aprovado_em">Data Aprovacao</Th>
                          <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Acoes</th>
                        </>
                      )
                    })()}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {opsFiltradas.map((op) => {
                    const status = statusConfig[op.status] || statusConfig.solicitada
                    const StatusIcon = status.icon
                    return (
                      <tr key={op.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-sm text-muted-foreground tabular-nums">{op.id.substring(0, 8)}</td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-foreground">{op.cedentes.razao_social}</p>
                          <p className="text-xs text-muted-foreground">{formatCNPJ(op.cedentes.cnpj)}</p>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium tabular-nums">{formatCurrency(op.valor_bruto_total)}</td>
                        <td className="px-4 py-3 text-sm tabular-nums">{op.taxa_desconto > 0 ? `${op.taxa_desconto}%` : '—'}</td>
                        <td className="px-4 py-3 text-sm tabular-nums">{op.prazo_dias}d</td>
                        <td className="px-4 py-3 text-sm font-bold text-green-700 dark:text-green-400 tabular-nums">{formatCurrency(op.valor_liquido_desembolso)}</td>
                        <td className="px-4 py-3">
                          <Badge variant={status.variant} className={status.className}>
                            <StatusIcon size={12} />
                            {status.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">
                          {op.aprovado_em ? formatDate(op.aprovado_em) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <Link href={`/gestor/operacoes/${op.id}`}>
                            <Button variant="ghost" size="sm" className="gap-1">
                              <Eye size={14} />
                              {op.status === 'solicitada' ? 'Analisar' : 'Ver'}
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
