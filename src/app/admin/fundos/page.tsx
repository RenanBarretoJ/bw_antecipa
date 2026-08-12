import Link from 'next/link'
import { Building2, Plus, Search } from 'lucide-react'
import { EmptyState, ListNameCell, StatusBadge } from '@/components/data-display/primitives'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { Input } from '@/components/ui/input'
import { listarAdminFundos } from '@/lib/admin/fundos.server'
import { parseAdminFundoFilters } from '@/lib/admin/fundos'
import { formatCNPJ } from '@/lib/utils'

const primaryLink = 'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80'
const outlineLink = 'inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted'

function pageHref(filters: ReturnType<typeof parseAdminFundoFilters>, pagina: number) {
  const params = new URLSearchParams()
  if (filters.busca) params.set('busca', filters.busca)
  if (filters.status !== 'todos') params.set('status', filters.status)
  if (filters.porPagina !== 20) params.set('porPagina', String(filters.porPagina))
  params.set('pagina', String(pagina))
  return `/admin/fundos?${params}`
}

export default async function AdminFundosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseAdminFundoFilters(await searchParams)
  const result = await listarAdminFundos(filters)

  return (
    <PageContainer className="space-y-5">
      <PageHeader eyebrow="Estrutura global" title="Fundos" description="Cadastre, consulte e controle o ciclo de vida dos fundos da plataforma." action={<Link href="/admin/fundos/novo" className={primaryLink}><Plus className="size-4" />Novo fundo</Link>} />

      <form method="get" className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_180px_140px_auto]">
        <div className="relative min-w-0"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input name="busca" defaultValue={filters.busca} placeholder="Nome ou CNPJ" className="pl-9" /></div>
        <select name="status" defaultValue={filters.status} className="h-8 min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm">
          <option value="todos">Todos os status</option><option value="ativos">Ativos</option><option value="inativos">Inativos</option>
        </select>
        <select name="porPagina" defaultValue={String(filters.porPagina)} className="h-8 min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm">
          <option value="20">20 por pagina</option><option value="50">50 por pagina</option><option value="100">100 por pagina</option>
        </select>
        <button type="submit" className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">Aplicar filtros</button>
      </form>

      <p className="text-sm text-muted-foreground">{result.total} fundo(s) encontrado(s)</p>
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {result.itens.length === 0 ? <EmptyState title="Nenhum fundo encontrado" description="Ajuste os filtros ou cadastre o primeiro fundo." icon={Building2} /> : (
          <div className="divide-y divide-border">
            {result.itens.map((fundo) => (
              <div key={fundo.id} className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px_auto]">
                <ListNameCell name={fundo.nome} subline={formatCNPJ(fundo.cnpj)} className="max-w-none" />
                <div className="min-w-0"><p className="truncate text-sm font-medium" title={fundo.gestora_nome}>{fundo.gestora_nome}</p><p className="truncate text-xs text-muted-foreground" title={fundo.administradora_nome}>{fundo.administradora_nome}</p></div>
                <StatusBadge status={fundo.ativo ? 'ativo' : 'desativada'} label={fundo.ativo ? 'Ativo' : 'Inativo'} />
                <Link href={`/admin/fundos/${fundo.id}`} className={outlineLink}>Detalhes</Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <nav className="flex items-center justify-between gap-3" aria-label="Paginacao">
        <span className="text-sm text-muted-foreground">Pagina {result.pagina} de {result.total_paginas}</span>
        <div className="flex gap-2">
          {result.pagina > 1 ? <Link className={outlineLink} href={pageHref(filters, result.pagina - 1)}>Anterior</Link> : <span className={`${outlineLink} pointer-events-none opacity-50`}>Anterior</span>}
          {result.pagina < result.total_paginas ? <Link className={outlineLink} href={pageHref(filters, result.pagina + 1)}>Proxima</Link> : <span className={`${outlineLink} pointer-events-none opacity-50`}>Proxima</span>}
        </div>
      </nav>
    </PageContainer>
  )
}
