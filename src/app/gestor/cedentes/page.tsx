'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Eye } from 'lucide-react'
import Link from 'next/link'
import { formatCNPJ, formatDate } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { DataTableContainer, EmptyState, FilterBar, LoadingState, StatusBadge } from '@/components/data-display/primitives'

interface CedenteRow { id: string; cnpj: string; razao_social: string; status: string; created_at: string }

export default function GestorCedentesPage() {
  const [cedentes, setCedentes] = useState<CedenteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [busca, setBusca] = useState('')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('cedentes').select('id, cnpj, razao_social, status, created_at').order('created_at', { ascending: false })
      setCedentes((data || []) as CedenteRow[])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = cedentes.filter((cedente) => {
    if (filtroStatus !== 'todos' && cedente.status !== filtroStatus) return false
    if (busca) {
      const query = busca.toLowerCase()
      return cedente.cnpj.includes(query) || cedente.razao_social.toLowerCase().includes(query)
    }
    return true
  })

  return (
    <PageContainer className="space-y-6">
      <PageHeader title="Cedentes" description="Acompanhe cadastro, status e documentos dos cedentes." eyebrow="Relacionamento" />

      <FilterBar search={busca} onSearch={setBusca} placeholder="Buscar por CNPJ ou razão social...">
        <Select value={filtroStatus} onValueChange={(value) => { if (value) setFiltroStatus(value) }}>
          <SelectTrigger className="w-full md:w-48"><SelectValue placeholder="Todos os status" /></SelectTrigger>
          <SelectContent><SelectItem value="todos">Todos os status</SelectItem><SelectItem value="pendente">Pendente</SelectItem><SelectItem value="em_analise">Em análise</SelectItem><SelectItem value="ativo">Ativo</SelectItem><SelectItem value="reprovado">Reprovado</SelectItem><SelectItem value="bloqueado">Bloqueado</SelectItem></SelectContent>
        </Select>
      </FilterBar>

      <DataTableContainer>
        {loading ? <LoadingState label="Carregando cedentes..." /> : filtered.length === 0 ? <EmptyState title="Nenhum cedente encontrado" description={busca || filtroStatus !== 'todos' ? 'Ajuste os filtros para tentar novamente.' : 'Ainda não há cedentes cadastrados.'} /> : <Table>
          <TableHeader><TableRow className="bg-muted/35 hover:bg-muted/35"><TableHead className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">CNPJ</TableHead><TableHead className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Razão social</TableHead><TableHead className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Data cadastro</TableHead><TableHead className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Status</TableHead><TableHead className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Ações</TableHead></TableRow></TableHeader>
          <TableBody>{filtered.map((cedente) => <TableRow key={cedente.id} className="align-middle"><TableCell className="whitespace-nowrap px-5 py-4 font-mono text-sm tabular-nums">{formatCNPJ(cedente.cnpj)}</TableCell><TableCell className="w-[280px] max-w-[280px] px-5 py-4"><p className="block truncate font-medium" title={cedente.razao_social}>{cedente.razao_social}</p></TableCell><TableCell className="whitespace-nowrap px-5 py-4 text-sm tabular-nums text-muted-foreground">{formatDate(cedente.created_at)}</TableCell><TableCell className="whitespace-nowrap px-5 py-4"><StatusBadge status={cedente.status} /></TableCell><TableCell className="whitespace-nowrap px-5 py-4 text-right"><Link href={`/gestor/cedentes/${cedente.id}`} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/10"><Eye size={15} /> Ver detalhes</Link></TableCell></TableRow>)}</TableBody>
        </Table>}
      </DataTableContainer>
      {!loading && <p className="text-xs text-muted-foreground">{filtered.length} de {cedentes.length} cedente(s) exibido(s).</p>}
    </PageContainer>
  )
}
