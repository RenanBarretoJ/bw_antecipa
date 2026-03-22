'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
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
import { Wallet, Eye, Search } from 'lucide-react'

interface ContaEscrowConsultor {
  id: string
  identificador: string
  saldo_disponivel: number
  saldo_bloqueado: number
  status: string
  created_at: string
  cedentes: { razao_social: string; cnpj: string }
}

function EscrowSkeleton() {
  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <Skeleton className="h-8 w-44 mb-2" />
      <Card><CardContent className="pt-4"><Skeleton className="h-11 w-full" /></CardContent></Card>
      <Card><CardContent className="pt-4 space-y-3">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </CardContent></Card>
    </div>
  )
}

export default function EscrowConsultorPage() {
  const [contas, setContas] = useState<ContaEscrowConsultor[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('contas_escrow')
        .select('id, identificador, saldo_disponivel, saldo_bloqueado, status, created_at, cedentes(razao_social, cnpj)')
        .order('created_at', { ascending: false })

      setContas((data || []) as ContaEscrowConsultor[])
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

  if (loading) return <EscrowSkeleton />

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Extratos Escrow</h1>
        <p className="text-muted-foreground">Visualizacao dos extratos dos cedentes da carteira (somente leitura).</p>
      </div>

      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar por identificador, razao social ou CNPJ..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9 h-11"
            />
          </div>
        </CardContent>
      </Card>

      {contasFiltradas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Wallet size={48} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhuma conta escrow encontrada.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase text-muted-foreground">Identificador</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground">Cedente</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground text-right">Disponivel</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground text-right">Bloqueado</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground">Status</TableHead>
                <TableHead className="text-xs uppercase text-muted-foreground">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contasFiltradas.map((conta) => (
                <TableRow key={conta.id}>
                  <TableCell className="font-mono text-sm">{conta.identificador}</TableCell>
                  <TableCell>
                    <p className="text-sm font-medium text-foreground">{conta.cedentes.razao_social}</p>
                    <p className="text-xs text-muted-foreground font-mono">{formatCNPJ(conta.cedentes.cnpj)}</p>
                  </TableCell>
                  <TableCell className="text-right text-sm font-bold tabular-nums text-green-700">
                    {formatCurrency(conta.saldo_disponivel)}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium tabular-nums text-yellow-700">
                    {formatCurrency(conta.saldo_bloqueado)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={conta.status === 'ativa' ? 'default' : 'destructive'}>
                      {conta.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/consultor/escrow/${conta.id}`}
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      <Eye size={14} /> Ver extrato
                    </Link>
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
