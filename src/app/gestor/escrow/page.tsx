'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  Wallet,
  Eye,
  Search,
  TrendingUp,
  Lock,
  CheckCircle,
  XCircle,
  AlertCircle,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'

interface ContaEscrowGestor {
  id: string
  identificador: string
  saldo_disponivel: number
  saldo_bloqueado: number
  status: string
  created_at: string
  cedentes: {
    razao_social: string
    cnpj: string
  }
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle }> = {
  ativa: { label: 'Ativa', variant: 'default', icon: CheckCircle },
  bloqueada: { label: 'Bloqueada', variant: 'secondary', icon: AlertCircle },
  encerrada: { label: 'Encerrada', variant: 'destructive', icon: XCircle },
}

export default function EscrowGestorPage() {
  const [contas, setContas] = useState<ContaEscrowGestor[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('contas_escrow')
        .select('id, identificador, saldo_disponivel, saldo_bloqueado, status, created_at, cedentes(razao_social, cnpj)')
        .order('created_at', { ascending: false })

      setContas((data || []) as ContaEscrowGestor[])
      setLoading(false)
    }
    load()
  }, [])

  const contasFiltradas = contas.filter((c) => {
    if (!busca) return true
    const term = busca.toLowerCase()
    return (
      c.identificador.toLowerCase().includes(term) ||
      c.cedentes.razao_social.toLowerCase().includes(term) ||
      c.cedentes.cnpj.includes(term)
    )
  })

  const saldoTotal = contas.reduce((acc, c) => acc + c.saldo_disponivel, 0)
  const saldoBloqueadoTotal = contas.reduce((acc, c) => acc + c.saldo_bloqueado, 0)
  const contasAtivas = contas.filter((c) => c.status === 'ativa').length

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Contas Escrow</h1>
        <p className="text-muted-foreground">Visao consolidada de todas as contas escrow.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet size={18} className="text-blue-600" />
                  <span className="text-xs text-muted-foreground">Total Contas</span>
                </div>
                <p className="text-2xl font-bold tabular-nums">{contas.length}</p>
                <p className="text-xs text-green-600 mt-1">{contasAtivas} ativas</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp size={18} className="text-green-600" />
                  <span className="text-xs text-muted-foreground">Saldo Disponivel Total</span>
                </div>
                <p className="text-2xl font-bold text-green-700 tabular-nums">{formatCurrency(saldoTotal)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Lock size={18} className="text-yellow-600" />
                  <span className="text-xs text-muted-foreground">Saldo Bloqueado Total</span>
                </div>
                <p className="text-2xl font-bold text-yellow-700 tabular-nums">{formatCurrency(saldoBloqueadoTotal)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet size={18} className="text-purple-600" />
                  <span className="text-xs text-muted-foreground">Volume Custodiado</span>
                </div>
                <p className="text-2xl font-bold text-purple-700 tabular-nums">{formatCurrency(saldoTotal + saldoBloqueadoTotal)}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Busca */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar por identificador, razao social ou CNPJ..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      {loading ? (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-24 ml-auto" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : contasFiltradas.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Wallet size={48} className="mx-auto text-muted-foreground mb-3 opacity-30" />
            <p className="text-muted-foreground">Nenhuma conta escrow encontrada.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs uppercase px-4 py-3">Identificador</TableHead>
                  <TableHead className="text-xs uppercase px-4 py-3">Cedente</TableHead>
                  <TableHead className="text-xs uppercase px-4 py-3 text-right">Disponivel</TableHead>
                  <TableHead className="text-xs uppercase px-4 py-3 text-right">Bloqueado</TableHead>
                  <TableHead className="text-xs uppercase px-4 py-3">Status</TableHead>
                  <TableHead className="text-xs uppercase px-4 py-3">Criada em</TableHead>
                  <TableHead className="text-xs uppercase px-4 py-3">Acoes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contasFiltradas.map((conta) => {
                  const st = statusConfig[conta.status] || statusConfig.ativa
                  const StIcon = st.icon
                  return (
                    <TableRow key={conta.id}>
                      <TableCell className="px-4 py-3 font-mono text-sm">{conta.identificador}</TableCell>
                      <TableCell className="px-4 py-3">
                        <p className="text-sm font-medium text-foreground">{conta.cedentes.razao_social}</p>
                        <p className="text-xs text-muted-foreground">{formatCNPJ(conta.cedentes.cnpj)}</p>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right text-sm font-bold text-green-700 tabular-nums">
                        {formatCurrency(conta.saldo_disponivel)}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-right text-sm font-medium text-yellow-700 tabular-nums">
                        {formatCurrency(conta.saldo_bloqueado)}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <Badge variant={st.variant} className="inline-flex items-center gap-1">
                          <StIcon size={12} />
                          {st.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-sm text-muted-foreground">{formatDate(conta.created_at)}</TableCell>
                      <TableCell className="px-4 py-3">
                        <Button variant="ghost" size="sm" className="h-auto p-0 text-blue-600 hover:text-blue-800 hover:bg-transparent" onClick={() => {}}>
                          <Link href={`/gestor/escrow/${conta.id}`} className="inline-flex items-center gap-1 text-sm">
                            <Eye size={14} /> Extrato
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
