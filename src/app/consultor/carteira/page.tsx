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
  Briefcase,
  Search,
  CheckCircle,
  Clock,
  XCircle,
  TrendingUp,
} from 'lucide-react'

interface CarteiraCedente {
  cedente_id: string
  comissao_percentual: number
  created_at: string
  cedentes: {
    razao_social: string
    cnpj: string
    status: string
    created_at: string
    nome_fantasia: string | null
  }
}

interface OperacaoResumoCedente {
  cedente_id: string
  valor_bruto_total: number
  status: string
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle }> = {
  pendente: { label: 'Pendente', variant: 'outline', icon: Clock },
  em_analise: { label: 'Em Analise', variant: 'secondary', icon: Clock },
  ativo: { label: 'Ativo', variant: 'default', icon: CheckCircle },
  reprovado: { label: 'Reprovado', variant: 'destructive', icon: XCircle },
  bloqueado: { label: 'Bloqueado', variant: 'destructive', icon: XCircle },
}

function CarteiraSkeleton() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}><CardContent className="pt-5"><Skeleton className="h-8 w-24 mb-1" /><Skeleton className="h-4 w-16" /></CardContent></Card>
        ))}
      </div>
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}><CardContent className="pt-5"><Skeleton className="h-16 w-full" /></CardContent></Card>
        ))}
      </div>
    </div>
  )
}

export default function CarteiraConsultorPage() {
  const [carteira, setCarteira] = useState<CarteiraCedente[]>([])
  const [operacoes, setOperacoes] = useState<OperacaoResumoCedente[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      const [carteiraRes, opsRes] = await Promise.all([
        supabase.from('consultor_cedentes')
          .select('cedente_id, comissao_percentual, created_at, cedentes(razao_social, cnpj, status, created_at, nome_fantasia)')
          .order('created_at', { ascending: false }),
        supabase.from('operacoes')
          .select('cedente_id, valor_bruto_total, status')
          .in('status', ['em_andamento', 'liquidada']),
      ])

      setCarteira((carteiraRes.data || []) as CarteiraCedente[])
      setOperacoes((opsRes.data || []) as OperacaoResumoCedente[])
      setLoading(false)
    }
    load()
  }, [])

  const getVolumeCedente = (cedenteId: string) => {
    return operacoes
      .filter((o) => o.cedente_id === cedenteId)
      .reduce((acc, o) => acc + o.valor_bruto_total, 0)
  }

  const getOpsAtivasCedente = (cedenteId: string) => {
    return operacoes.filter((o) => o.cedente_id === cedenteId && o.status === 'em_andamento').length
  }

  const carteiraFiltrada = carteira.filter((c) => {
    if (!busca) return true
    const term = busca.toLowerCase()
    return c.cedentes.razao_social.toLowerCase().includes(term) ||
      c.cedentes.cnpj.includes(term) ||
      (c.cedentes.nome_fantasia || '').toLowerCase().includes(term)
  })

  const volumeTotal = carteira.reduce((acc, c) => acc + getVolumeCedente(c.cedente_id), 0)

  if (loading) return <CarteiraSkeleton />

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Minha Carteira</h1>
        <p className="text-muted-foreground">Cedentes vinculados sob sua responsabilidade.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <Briefcase size={18} className="text-amber-600" />
            <span className="text-xs text-amber-600">Total Cedentes</span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-amber-700">{carteira.length}</p>
        </div>
        <div className="bg-green-50 dark:bg-green-500/10 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={18} className="text-green-600" />
            <span className="text-xs text-green-600">Ativos</span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-green-700">{carteira.filter((c) => c.cedentes.status === 'ativo').length}</p>
        </div>
        <div className="bg-purple-50 dark:bg-purple-500/10 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={18} className="text-purple-600" />
            <span className="text-xs text-purple-600">Volume Total</span>
          </div>
          <p className="text-2xl font-bold tabular-nums text-purple-700">{formatCurrency(volumeTotal)}</p>
        </div>
      </div>

      {/* Busca */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar cedente..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9 h-11"
            />
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      {carteiraFiltrada.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Briefcase size={48} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhum cedente na carteira.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {carteiraFiltrada.map((c) => {
            const st = statusConfig[c.cedentes.status]
            const StIcon = st?.icon || Clock
            const volume = getVolumeCedente(c.cedente_id)
            const opsAtivas = getOpsAtivasCedente(c.cedente_id)

            return (
              <Card key={c.cedente_id}>
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <p className="font-semibold text-foreground text-lg">{c.cedentes.razao_social}</p>
                        <Badge variant={st?.variant || 'outline'}>
                          <StIcon size={12} />
                          {st?.label || c.cedentes.status}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">CNPJ</span>
                          <p className="font-mono tabular-nums">{formatCNPJ(c.cedentes.cnpj)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Nome Fantasia</span>
                          <p>{c.cedentes.nome_fantasia || '—'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Volume Operado</span>
                          <p className="font-bold tabular-nums">{formatCurrency(volume)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Ops Ativas</span>
                          <p className="font-medium tabular-nums">{opsAtivas}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Comissao</span>
                          <p className="font-medium tabular-nums text-green-700">{c.comissao_percentual}%</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
