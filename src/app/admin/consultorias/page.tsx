import Link from 'next/link'
import { Building2, Plus, Search } from 'lucide-react'
import { EmptyState, ListNameCell, StatusBadge } from '@/components/data-display/primitives'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { Input } from '@/components/ui/input'
import { listarAdminConsultorias } from '@/lib/admin/consultorias.server'
import { parseConsultoriaFilters } from '@/lib/admin/consultorias'
import { formatCNPJ } from '@/lib/utils'

const primaryLink = 'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80'
const outlineLink = 'inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted'

function pageHref(filters: ReturnType<typeof parseConsultoriaFilters>, pagina: number) {
  const params = new URLSearchParams()
  if (filters.busca) params.set('busca', filters.busca)
  if (filters.status !== 'todos') params.set('status', filters.status)
  if (filters.porPagina !== 20) params.set('porPagina', String(filters.porPagina))
  params.set('pagina', String(pagina))
  return `/admin/consultorias?${params}`
}

export default async function AdminConsultoriasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseConsultoriaFilters(await searchParams)
  const result = await listarAdminConsultorias(filters)
  return (
    <PageContainer className="space-y-5">
      <PageHeader eyebrow="Estrutura global" title="Consultorias" description="Organizacoes proprietarias da carteira, seus usuarios e Fundos autorizados." action={<Link href="/admin/consultorias/nova" className={primaryLink}><Plus className="size-4" />Nova Consultoria</Link>} />
      <form method="get" className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_180px_140px_auto]">
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input name="busca" defaultValue={filters.busca} placeholder="Razao Social, Nome Fantasia ou CNPJ" className="pl-9" /></div>
        <select name="status" defaultValue={filters.status} className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"><option value="todos">Todos os status</option><option value="ativo">Ativas</option><option value="inativo">Inativas</option></select>
        <select name="porPagina" defaultValue={String(filters.porPagina)} className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"><option value="20">20 por pagina</option><option value="50">50 por pagina</option><option value="100">100 por pagina</option></select>
        <button type="submit" className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">Aplicar</button>
      </form>
      <p className="text-sm text-muted-foreground">{result.total} Consultoria(s) encontrada(s)</p>
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {result.itens.length === 0 ? <EmptyState title="Nenhuma Consultoria encontrada" description="Ajuste os filtros ou cadastre a primeira organizacao." icon={Building2} /> : <div className="divide-y divide-border">{result.itens.map((item) => <div key={item.id} className="grid items-center gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1.5fr)_120px_110px_minmax(160px,1fr)_auto]">
          <ListNameCell name={item.nome_fantasia || item.razao_social} subline={`${item.razao_social} · ${formatCNPJ(item.cnpj)}`} className="max-w-none" />
          <StatusBadge status={item.status === 'ativo' ? 'ativo' : 'desativada'} label={item.status === 'ativo' ? 'Ativa' : 'Inativa'} />
          <p className="text-sm text-muted-foreground">{item.usuarios_ativos} usuario(s)<br />{item.cedentes_total} Cedente(s)</p>
          <p className="truncate text-sm text-muted-foreground" title={item.fundos.map((f) => f.nome).join(', ')}>{item.fundos.length ? item.fundos.map((f) => f.nome).join(', ') : 'Sem Fundo ativo'}</p>
          <Link href={`/admin/consultorias/${item.id}`} className={outlineLink}>Detalhes</Link>
        </div>)}</div>}
      </section>
      <nav className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Pagina {result.pagina} de {result.total_paginas}</span><div className="flex gap-2">{result.pagina > 1 ? <Link className={outlineLink} href={pageHref(filters, result.pagina - 1)}>Anterior</Link> : <span className={`${outlineLink} pointer-events-none opacity-50`}>Anterior</span>}{result.pagina < result.total_paginas ? <Link className={outlineLink} href={pageHref(filters, result.pagina + 1)}>Proxima</Link> : <span className={`${outlineLink} pointer-events-none opacity-50`}>Proxima</span>}</div></nav>
    </PageContainer>
  )
}
