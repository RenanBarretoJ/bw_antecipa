'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  Calendar,
  Search,
  TrendingUp,
  Lock,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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
}

interface Movimento {
  id: string
  tipo: string
  descricao: string
  valor: number
  saldo_apos: number
  created_at: string
}

export default function ExtratoCedentePage() {
  const router = useRouter()
  const [conta, setConta] = useState<ContaEscrow | null>(null)
  const [movimentos, setMovimentos] = useState<Movimento[]>([])
  const [loading, setLoading] = useState(true)
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<string>('todos')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      // Verificar se escrow está habilitado para este cedente
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: cedente } = await supabase
          .from('cedentes')
          .select('habilitar_escrow')
          .eq('user_id', user.id)
          .single()

        if (!cedente || !(cedente as { habilitar_escrow: boolean }).habilitar_escrow) {
          router.replace('/cedente/dashboard')
          return
        }
      }

      // Buscar conta escrow do cedente (via RLS)
      const { data: contas } = await supabase
        .from('contas_escrow')
        .select('id, identificador, saldo_disponivel, saldo_bloqueado, status, created_at')
        .limit(1)

      if (contas && contas.length > 0) {
        const c = contas[0] as ContaEscrow
        setConta(c)

        // Buscar movimentos
        const { data: movs } = await supabase
          .from('movimentos_escrow')
          .select('id, tipo, descricao, valor, saldo_apos, created_at')
          .eq('conta_escrow_id', c.id)
          .order('created_at', { ascending: false })

        setMovimentos((movs || []) as Movimento[])
      }

      setLoading(false)
    }
    load()
  }, [])

  // Filtrar movimentos
  const movsFiltrados = movimentos.filter((m) => {
    if (filtroTipo !== 'todos' && m.tipo !== filtroTipo) return false
    if (dataInicio) {
      const movDate = m.created_at.split('T')[0]
      if (movDate < dataInicio) return false
    }
    if (dataFim) {
      const movDate = m.created_at.split('T')[0]
      if (movDate > dataFim) return false
    }
    return true
  })

  const totalCreditos = movsFiltrados
    .filter((m) => m.tipo === 'credito')
    .reduce((acc, m) => acc + m.valor, 0)
  const totalDebitos = movsFiltrados
    .filter((m) => m.tipo === 'debito')
    .reduce((acc, m) => acc + m.valor, 0)

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="pt-4">
                <Skeleton className="h-4 w-32 mb-3" />
                <Skeleton className="h-9 w-40" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
        <Card>
          <CardContent className="pt-4 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!conta) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <Wallet size={48} className="mx-auto text-muted-foreground/30 mb-3" />
        <p className="text-muted-foreground">Sua conta escrow ainda nao foi criada.</p>
        <p className="text-sm text-muted-foreground/70 mt-1">Ela sera criada automaticamente apos a aprovacao do seu cadastro.</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Extrato da Conta Escrow</h1>
        <p className="text-muted-foreground font-mono">{conta.identificador}</p>
      </div>

      {/* Saldos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-green-100 rounded-lg dark:bg-green-900/30">
                <Wallet size={20} className="text-green-600 dark:text-green-400" />
              </div>
              <span className="text-sm text-muted-foreground">Saldo Disponivel</span>
            </div>
            <p className="text-3xl font-bold tabular-nums text-green-700 dark:text-green-400">
              {formatCurrency(conta.saldo_disponivel)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-yellow-100 rounded-lg dark:bg-yellow-900/30">
                <Lock size={20} className="text-yellow-600 dark:text-yellow-400" />
              </div>
              <span className="text-sm text-muted-foreground">Saldo Bloqueado</span>
            </div>
            <p className="text-3xl font-bold tabular-nums text-yellow-700 dark:text-yellow-400">
              {formatCurrency(conta.saldo_bloqueado)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-100 rounded-lg dark:bg-blue-900/30">
                <TrendingUp size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-sm text-muted-foreground">Saldo Total</span>
            </div>
            <p className="text-3xl font-bold tabular-nums text-blue-700 dark:text-blue-400">
              {formatCurrency(conta.saldo_disponivel + conta.saldo_bloqueado)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Resumo do periodo */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card className="bg-green-50 dark:bg-green-900/20">
          <CardContent className="pt-4 flex items-center gap-3">
            <ArrowUpCircle size={24} className="text-green-600 dark:text-green-400 shrink-0" />
            <div>
              <p className="text-xs text-green-700 dark:text-green-400 font-medium">Total Creditos</p>
              <p className="text-xl font-bold tabular-nums text-green-700 dark:text-green-400">
                {formatCurrency(totalCreditos)}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-red-50 dark:bg-red-900/20">
          <CardContent className="pt-4 flex items-center gap-3">
            <ArrowDownCircle size={24} className="text-red-600 dark:text-red-400 shrink-0" />
            <div>
              <p className="text-xs text-red-700 dark:text-red-400 font-medium">Total Debitos</p>
              <p className="text-xl font-bold tabular-nums text-red-700 dark:text-red-400">
                {formatCurrency(totalDebitos)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex items-center gap-2 flex-1">
              <Calendar size={16} className="text-muted-foreground shrink-0" />
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                placeholder="Data inicio"
              />
              <span className="text-muted-foreground text-sm shrink-0">ate</span>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                placeholder="Data fim"
              />
            </div>
            <Select value={filtroTipo} onValueChange={(v) => { if (v) setFiltroTipo(v) }}>
              <SelectTrigger className="w-full sm:w-36">
                <SelectValue placeholder="Tipo" />
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

      {/* Movimentos */}
      {movsFiltrados.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <Search size={40} className="text-muted-foreground/30" />
            <p className="text-muted-foreground font-medium">Nenhum movimento encontrado.</p>
            <p className="text-sm text-muted-foreground/70">
              Tente ajustar os filtros de data ou tipo de movimentacao.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4 text-xs uppercase text-muted-foreground">Data</TableHead>
                <TableHead className="px-4 text-xs uppercase text-muted-foreground">Tipo</TableHead>
                <TableHead className="px-4 text-xs uppercase text-muted-foreground">Descricao</TableHead>
                <TableHead className="px-4 text-xs uppercase text-muted-foreground text-right">Valor</TableHead>
                <TableHead className="px-4 text-xs uppercase text-muted-foreground text-right">Saldo Apos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movsFiltrados.map((mov) => (
                <TableRow key={mov.id}>
                  <TableCell className="px-4 text-muted-foreground tabular-nums">
                    {new Date(mov.created_at).toLocaleString('pt-BR', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </TableCell>
                  <TableCell className="px-4">
                    {mov.tipo === 'credito' ? (
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border-transparent gap-1">
                        <ArrowUpCircle size={12} /> Credito
                      </Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-transparent gap-1">
                        <ArrowDownCircle size={12} /> Debito
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="px-4 text-foreground">{mov.descricao}</TableCell>
                  <TableCell className={`px-4 text-right font-bold tabular-nums ${
                    mov.tipo === 'credito' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                  }`}>
                    {mov.tipo === 'credito' ? '+' : '-'}{formatCurrency(mov.valor)}
                  </TableCell>
                  <TableCell className="px-4 text-right text-muted-foreground font-medium tabular-nums">
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
