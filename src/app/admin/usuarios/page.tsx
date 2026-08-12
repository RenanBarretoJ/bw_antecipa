import Link from 'next/link'
import { Plus, Search, UserRoundCog } from 'lucide-react'
import { EmptyState, ListNameCell, MetricCard, StatusBadge } from '@/components/data-display/primitives'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { Input } from '@/components/ui/input'
import { carregarResumoAdminUsuarios, listarAdminUsuarios } from '@/lib/admin/usuarios.server'
import { parseAdminUsuarioFilters } from '@/lib/admin/usuarios'

const primaryLink = 'inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80'
const outlineLink = 'inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted'

function pageHref(filters: ReturnType<typeof parseAdminUsuarioFilters>, pagina: number) {
  const params = new URLSearchParams()
  if (filters.busca) params.set('busca', filters.busca)
  if (filters.papel !== 'todos') params.set('papel', filters.papel)
  if (filters.status !== 'todos') params.set('status', filters.status)
  if (filters.superAdmin !== 'todos') params.set('superAdmin', filters.superAdmin)
  if (filters.porPagina !== 20) params.set('porPagina', String(filters.porPagina))
  params.set('pagina', String(pagina))
  return `/admin/usuarios?${params}`
}

export default async function AdminUsuariosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = parseAdminUsuarioFilters(await searchParams)
  const [resumo, result] = await Promise.all([carregarResumoAdminUsuarios(), listarAdminUsuarios(filters)])

  return (
    <PageContainer className="space-y-5">
      <PageHeader eyebrow="Estrutura global" title="Usuarios & Acessos" description="Administre Gestores, Super Admins e vinculos explicitos por fundo." action={<Link href="/admin/usuarios/novo" className={primaryLink}><Plus className="size-4" />Novo usuario</Link>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Usuarios" value={resumo.total} />
        <MetricCard label="Ativos" value={resumo.ativos} tone="success" />
        <MetricCard label="Inativos" value={resumo.inativos} />
        <MetricCard label="Gestores" value={resumo.gestores} tone="info" />
        <MetricCard label="Super Admins" value={resumo.super_admins} tone="warning" />
      </div>

      <form method="get" className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm lg:grid-cols-[minmax(220px,1fr)_150px_150px_160px_130px_auto]">
        <div className="relative min-w-0"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input name="busca" defaultValue={filters.busca} placeholder="Nome ou e-mail" className="pl-9" /></div>
        <select name="papel" defaultValue={filters.papel} className="h-8 min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm"><option value="todos">Todos os papeis</option><option value="gestor">Gestor</option><option value="super_admin">Super Admin</option><option value="cedente">Cedente</option><option value="consultor">Consultor</option><option value="sacado">Sacado</option></select>
        <select name="status" defaultValue={filters.status} className="h-8 min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm"><option value="todos">Todos os status</option><option value="ativos">Ativos</option><option value="inativos">Inativos</option></select>
        <select name="superAdmin" defaultValue={filters.superAdmin} className="h-8 min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm"><option value="todos">Capacidade: todas</option><option value="sim">Com Super Admin</option><option value="nao">Sem Super Admin</option></select>
        <select name="porPagina" defaultValue={String(filters.porPagina)} className="h-8 min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm"><option value="20">20 por pagina</option><option value="50">50 por pagina</option><option value="100">100 por pagina</option></select>
        <button type="submit" className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">Aplicar</button>
      </form>

      <p className="text-sm text-muted-foreground">{result.total} usuario(s) encontrado(s)</p>
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {result.itens.length === 0 ? <EmptyState title="Nenhum usuario encontrado" description="Ajuste os filtros ou envie o primeiro convite administrativo." icon={UserRoundCog} /> : (
          <div className="divide-y divide-border">
            {result.itens.map((usuario) => (
              <div key={usuario.id} className="grid items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.5fr)_145px_115px_110px_110px_auto]">
                <ListNameCell name={usuario.nome_completo} subline={usuario.email} className="max-w-none" sublineClassName="font-sans" />
                <div><p className="text-sm font-medium capitalize">{usuario.papel_primario.replaceAll('_', ' ')}</p>{usuario.super_admin && usuario.papel_primario !== 'super_admin' && <p className="text-xs text-primary">+ Super Admin</p>}</div>
                <StatusBadge status={usuario.status === 'ativo' ? 'ativo' : 'desativada'} label={usuario.status === 'ativo' ? 'Ativo' : 'Inativo'} />
                <p className="text-sm text-muted-foreground">{usuario.fundos_ativos} fundo(s)</p>
                <StatusBadge status={usuario.mfa_configurado ? 'ativo' : 'pendente'} label={usuario.mfa_configurado ? 'MFA ativo' : 'MFA pendente'} />
                <Link href={`/admin/usuarios/${usuario.id}`} className={outlineLink}>Detalhes</Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <nav className="flex items-center justify-between gap-3" aria-label="Paginacao"><span className="text-sm text-muted-foreground">Pagina {result.pagina} de {result.total_paginas}</span><div className="flex gap-2">{result.pagina > 1 ? <Link className={outlineLink} href={pageHref(filters, result.pagina - 1)}>Anterior</Link> : <span className={`${outlineLink} pointer-events-none opacity-50`}>Anterior</span>}{result.pagina < result.total_paginas ? <Link className={outlineLink} href={pageHref(filters, result.pagina + 1)}>Proxima</Link> : <span className={`${outlineLink} pointer-events-none opacity-50`}>Proxima</span>}</div></nav>
    </PageContainer>
  )
}
