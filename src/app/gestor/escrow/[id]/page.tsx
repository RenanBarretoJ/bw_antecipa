'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  ArrowLeft,
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  Calendar,
  Lock,
  TrendingUp,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableHeader,
  TableBody,
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

interface ContaEscrow {
  id: string
  identificador: string
  saldo_disponivel: number
  saldo_bloqueado: number
  status: string
  created_at: string
  cedentes: { razao_social: string; cnpj: string }
}

interface Movimento {
  id: string
  tipo: string
  descricao: string
  valor: number
  saldo_apos: number
  created_at: string
}

export default function EscrowDetalhePage() {
  const params = useParams()
  const contaId = params.id as string

  const [conta, setConta] = useState<ContaEscrow | null>(null)
  const [movimentos, setMovimentos] = useState<Movimento[]>([])
  const [loading, setLoading] = useState(true)
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const { data: c } = await supabase
        .from('contas_escrow')
        .select('id, identificador, saldo_disponivel, saldo_bloqueado, status, created_at, cedentes(razao_social, cnpj)')
        .eq('id', contaId)
        .single()

      if (c) {
        setConta(c as ContaEscrow)
        const { data: movs } = await supabase
          .from('movimentos_escrow')
          .select('id, tipo, descricao, valor, saldo_apos, created_at')
          .eq('conta_escrow_id', contaId)
          .order('created_at', { ascending: false })

        setMovimentos((movs || []) as Movimento[])
      }
      setLoading(false)
    }
    load()
  }, [contaId])

  const movsFiltrados = movimentos.filter((m) => {
    if (filtroTipo !== 'todos' && m.tipo !== filtroTipo) return false
    if (dataInicio && m.created_at.split('T')[0] < dataInicio) return false
    if (dataFim && m.created_at.split('T')[0] > dataFim) return false
    return true
  })

  const totalCreditos = movsFiltrados.filter((m) => m.tipo === 'credito').reduce((acc, m) => acc + m.valor, 0)
  const totalDebitos = movsFiltrados.filter((m) => m.tipo === 'debito').reduce((acc, m) => acc + m.valor, 0)

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto">
        <Skeleton className="h-4 w-20 mb-6" />
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-48 mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 mb-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-32 mb-2" />
                <Skeleton className="h-7 w-40" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-24 ml-auto" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!conta) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Conta escrow nao encontrada.</p>
        <Link href="/gestor/escrow" className="text-blue-600 mt-2 inline-block">Voltar</Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-4 px-0 text-muted-foreground hover:text-foreground hover:bg-transparent">
        <Link href="/gestor/escrow" className="inline-flex items-center gap-1 text-sm">
          <ArrowLeft size={16} /> Voltar
        </Link>
      </Button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{conta.identificador}</h1>
          <p className="text-muted-foreground">{conta.cedentes.razao_social} — {formatCNPJ(conta.cedentes.cnpj)}</p>
        </div>
        <Badge variant={conta.status === 'ativa' ? 'default' : 'destructive'}>
          {conta.status}
        </Badge>
      </div>

      {/* Saldos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <Wallet size={18} className="text-green-600" />
              <span className="text-xs text-muted-foreground">Disponivel</span>
            </div>
            <p className="text-2xl font-bold text-green-700 tabular-nums">{formatCurrency(conta.saldo_disponivel)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <Lock size={18} className="text-yellow-600" />
              <span className="text-xs text-muted-foreground">Bloqueado</span>
            </div>
            <p className="text-2xl font-bold text-yellow-700 tabular-nums">{formatCurrency(conta.saldo_bloqueado)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={18} className="text-blue-600" />
              <span className="text-xs text-muted-foreground">Total</span>
            </div>
            <p className="text-2xl font-bold text-blue-700 tabular-nums">{formatCurrency(conta.saldo_disponivel + conta.saldo_bloqueado)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Resumo periodo */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-green-50 rounded-xl p-4 flex items-center gap-3">
          <ArrowUpCircle size={24} className="text-green-600" />
          <div>
            <p className="text-xs text-green-600 font-medium">Creditos no periodo</p>
            <p className="text-xl font-bold text-green-700 tabular-nums">{formatCurrency(totalCreditos)}</p>
          </div>
        </div>
        <div className="bg-red-50 rounded-xl p-4 flex items-center gap-3">
          <ArrowDownCircle size={24} className="text-destructive" />
          <div>
            <p className="text-xs text-destructive font-medium">Debitos no periodo</p>
            <p className="text-xl font-bold text-destructive tabular-nums">{formatCurrency(totalDebitos)}</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center gap-2 flex-1">
              <Calendar size={16} className="text-muted-foreground shrink-0" />
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="w-auto"
              />
              <span className="text-muted-foreground text-sm">ate</span>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="w-auto"
              />
            </div>
            <Select value={filtroTipo} onValueChange={(v) => { if (v) setFiltroTipo(v) }}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="credito">Creditos</SelectItem>
                <SelectItem value="debito">Debitos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabela de movimentos */}
      {movsFiltrados.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-muted-foreground">Nenhum movimento encontrado.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs uppercase px-4 py-3">Data</TableHead>
                  <TableHead className="text-xs uppercase px-4 py-3">Tipo</TableHead>
                  <TableHead className="text-xs uppercase px-4 py-3">Descricao</TableHead>
                  <TableHead className="text-xs uppercase px-4 py-3 text-right">Valor</TableHead>
                  <TableHead className="text-xs uppercase px-4 py-3 text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movsFiltrados.map((mov) => (
                  <TableRow key={mov.id}>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {new Date(mov.created_at).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      {mov.tipo === 'credito' ? (
                        <Badge variant="default" className="inline-flex items-center gap-1">
                          <ArrowUpCircle size={12} /> Credito
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="inline-flex items-center gap-1">
                          <ArrowDownCircle size={12} /> Debito
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-foreground">{mov.descricao}</TableCell>
                    <TableCell className={`px-4 py-3 text-sm text-right font-bold tabular-nums ${
                      mov.tipo === 'credito' ? 'text-green-700' : 'text-destructive'
                    }`}>
                      {mov.tipo === 'credito' ? '+' : '-'}{formatCurrency(mov.valor)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-right text-muted-foreground font-medium tabular-nums">
                      {formatCurrency(mov.saldo_apos)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
