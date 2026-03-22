'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Search, Eye } from 'lucide-react'
import Link from 'next/link'
import { formatCNPJ, formatDate } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'

interface CedenteRow {
  id: string
  cnpj: string
  razao_social: string
  status: string
  created_at: string
}

const statusBadge: Record<string, { label: string; className: string }> = {
  pendente:   { label: 'Pendente',   className: 'bg-gray-100 text-gray-700 border-gray-200' },
  em_analise: { label: 'Em Analise', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  ativo:      { label: 'Ativo',      className: 'bg-green-100 text-green-700 border-green-200' },
  reprovado:  { label: 'Reprovado',  className: 'bg-red-100 text-red-700 border-red-200' },
  bloqueado:  { label: 'Bloqueado',  className: 'bg-red-100 text-red-700 border-red-200' },
}

export default function GestorCedentesPage() {
  const [cedentes, setCedentes] = useState<CedenteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('')
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('cedentes')
        .select('id, cnpj, razao_social, status, created_at')
        .order('created_at', { ascending: false })

      setCedentes((data || []) as CedenteRow[])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = cedentes.filter((c) => {
    if (filtroStatus && c.status !== filtroStatus) return false
    if (busca) {
      const q = busca.toLowerCase()
      return c.cnpj.includes(q) || c.razao_social.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground mb-6">Cedentes</h1>

      {/* Filtros */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Buscar por CNPJ ou razao social..."
                className="pl-10"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
            <Select value={filtroStatus || '__all__'} onValueChange={(v) => { if (v) setFiltroStatus(v === '__all__' ? '' : v) }}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Todos os status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os status</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="em_analise">Em Analise</SelectItem>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="reprovado">Reprovado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">CNPJ</TableHead>
                <TableHead className="px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Razao Social</TableHead>
                <TableHead className="px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Data Cadastro</TableHead>
                <TableHead className="px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</TableHead>
                <TableHead className="px-6 py-3 text-xs font-semibold text-muted-foreground uppercase text-right">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-6 py-4"><Skeleton className="h-4 w-36" /></TableCell>
                    <TableCell className="px-6 py-4"><Skeleton className="h-4 w-48" /></TableCell>
                    <TableCell className="px-6 py-4"><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="px-6 py-4"><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    <TableCell className="px-6 py-4"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Nenhum cedente encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c) => {
                  const badge = statusBadge[c.status] || statusBadge.pendente
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="px-6 py-4 font-mono tabular-nums text-foreground">
                        {formatCNPJ(c.cnpj)}
                      </TableCell>
                      <TableCell className="px-6 py-4 font-medium text-foreground">
                        {c.razao_social}
                      </TableCell>
                      <TableCell className="px-6 py-4 tabular-nums text-muted-foreground">
                        {formatDate(c.created_at)}
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <Badge className={badge.className}>
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-6 py-4 text-right">
                        <Link href={`/gestor/cedentes/${c.id}`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium">
                          <Eye size={16} /> Ver detalhes
                        </Link>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
