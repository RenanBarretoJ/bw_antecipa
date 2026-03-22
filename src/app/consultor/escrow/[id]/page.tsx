'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ } from '@/lib/utils'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ArrowLeft,
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  Calendar,
} from 'lucide-react'

interface ContaEscrow {
  id: string
  identificador: string
  saldo_disponivel: number
  saldo_bloqueado: number
  status: string
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

function EscrowDetalheSkeleton() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Skeleton className="h-4 w-20" />
      <div>
        <Skeleton className="h-8 w-56 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card><CardContent className="pt-5"><Skeleton className="h-8 w-40 mb-1" /><Skeleton className="h-4 w-24" /></CardContent></Card>
        <Card><CardContent className="pt-5"><Skeleton className="h-8 w-40 mb-1" /><Skeleton className="h-4 w-24" /></CardContent></Card>
      </div>
      <Card><CardContent className="pt-4 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </CardContent></Card>
    </div>
  )
}

export default function EscrowDetalheConsultorPage() {
  const params = useParams()
  const contaId = params.id as string

  const [conta, setConta] = useState<ContaEscrow | null>(null)
  const [movimentos, setMovimentos] = useState<Movimento[]>([])
  const [loading, setLoading] = useState(true)
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const { data: c } = await supabase
        .from('contas_escrow')
        .select('id, identificador, saldo_disponivel, saldo_bloqueado, status, cedentes(razao_social, cnpj)')
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
    if (dataInicio && m.created_at.split('T')[0] < dataInicio) return false
    if (dataFim && m.created_at.split('T')[0] > dataFim) return false
    return true
  })

  if (loading) return <EscrowDetalheSkeleton />

  if (!conta) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Conta nao encontrada.</p>
        <Link href="/consultor/escrow" className="text-primary mt-2 inline-block hover:underline">Voltar</Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/consultor/escrow" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft size={16} /> Voltar
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">{conta.identificador}</h1>
        <p className="text-muted-foreground">{conta.cedentes.razao_social} — {formatCNPJ(conta.cedentes.cnpj)}</p>
        <p className="text-xs text-amber-600 mt-1">Somente leitura</p>
      </div>

      {/* Saldos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <Wallet size={18} className="text-green-600" />
              <span className="text-xs text-muted-foreground">Saldo Disponivel</span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-green-700">{formatCurrency(conta.saldo_disponivel)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2 mb-1">
              <Wallet size={18} className="text-yellow-600" />
              <span className="text-xs text-muted-foreground">Saldo Bloqueado</span>
            </div>
            <p className="text-2xl font-bold tabular-nums text-yellow-700">{formatCurrency(conta.saldo_bloqueado)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Calendar size={16} className="text-muted-foreground" />
            <div className="flex items-center gap-2">
              <Label htmlFor="data-inicio" className="text-sm text-muted-foreground whitespace-nowrap">De</Label>
              <Input
                id="data-inicio"
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="w-40 h-9"
              />
            </div>
            <span className="text-muted-foreground text-sm">ate</span>
            <div className="flex items-center gap-2">
              <Label htmlFor="data-fim" className="text-sm text-muted-foreground whitespace-nowrap">Ate</Label>
              <Input
                id="data-fim"
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="w-40 h-9"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Movimentos */}
      {movsFiltrados.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Nenhum movimento encontrado.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase text-muted-foreground">Data</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground">Tipo</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground">Descricao</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground text-right">Valor</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movsFiltrados.map((mov) => (
                <TableRow key={mov.id}>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">
                    {new Date(mov.created_at).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </TableCell>
                  <TableCell>
                    {mov.tipo === 'credito' ? (
                      <Badge variant="default" className="gap-1">
                        <ArrowUpCircle size={12} /> Credito
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <ArrowDownCircle size={12} /> Debito
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-foreground">{mov.descricao}</TableCell>
                  <TableCell className={`text-sm text-right font-bold tabular-nums ${
                    mov.tipo === 'credito' ? 'text-green-700' : 'text-destructive'
                  }`}>
                    {mov.tipo === 'credito' ? '+' : '-'}{formatCurrency(mov.valor)}
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums text-muted-foreground font-medium">
                    {formatCurrency(mov.saldo_apos)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
