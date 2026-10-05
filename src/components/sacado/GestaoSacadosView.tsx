import Link from 'next/link'
import { ArrowLeft, ArrowRight, Building2, ChevronDown, ChevronLeft, ChevronRight, Search, ShieldCheck, Users } from 'lucide-react'
import type { carregarGestaoSacados } from '@/lib/sacado/gestao.server'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { buttonVariants } from '@/components/ui/button-variants'
import { Input } from '@/components/ui/input'
import { GestaoAcessoForm } from './GestaoAcessoForm'
import { cn, formatCNPJ, formatDate } from '@/lib/utils'

type GestaoSacadosResult = Awaited<ReturnType<typeof carregarGestaoSacados>>

function StatusAcesso({ status }: { status: string }) {
  const label = { ativo: 'Ativo', inativo: 'Inativo', revogado: 'Revogado', bloqueado: 'Bloqueado' }[status] ?? status
  return <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
    status === 'ativo' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
      : status === 'revogado' || status === 'bloqueado' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}>
    <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{label}
  </span>
}

export function GestaoSacadosView({ result, basePath }: { result: GestaoSacadosResult; basePath: string }) {
  const href = (usuario: string | null, pagina = result.pagina) => `${basePath}?${new URLSearchParams({ fundo: result.fundo.id, busca: result.busca, pagina: String(pagina), ...(usuario ? { usuario } : {}) })}`
  const selected = result.usuarios.find(u => u.id === result.userId)
  const paginas = Math.max(1, Math.ceil(result.total / 20))
  const ativos = result.acessos.filter(a => a.status === 'ativo').length
  const outlineLink = buttonVariants({ variant: 'outline', size: 'lg' })

  return <PageContainer className="space-y-6">
    <PageHeader eyebrow="Gestão de acessos" title="Sacados" description="Acompanhe os usuários e gerencie os CNPJs autorizados em cada fundo." />
    <form method="get" action={basePath} className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0 space-y-2"><label htmlFor="sacado-fundo" className="text-sm font-medium">Fundo consultado</label>
          <select id="sacado-fundo" name="fundo" defaultValue={result.fundo.id} className="block h-10 w-full min-w-0 truncate rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {result.fundos.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </div>
        <div className="min-w-0 space-y-2"><label htmlFor="sacado-busca" className="text-sm font-medium">Nome ou e-mail</label>
          <div className="relative"><Search aria-hidden="true" className="absolute top-3 left-3 size-4 text-muted-foreground" />
            <Input id="sacado-busca" type="search" name="busca" defaultValue={result.busca} placeholder="Buscar usuário sacado" className="h-10 w-full pl-9" />
          </div>
        </div>
        <button className={cn(buttonVariants({ size: 'lg' }), 'h-10 px-5')} type="submit">Buscar</button>
      </div>
      <p className="text-xs text-muted-foreground">Primeiro vínculo neste fundo? Busque o e-mail completo de um usuário já cadastrado para adicionar seus CNPJs.</p>
    </form>

    {selected ? <>
      <Link className={outlineLink} href={href(null)}><ArrowLeft aria-hidden="true" />Voltar aos sacados</Link>
      <section className="space-y-4 rounded-xl border border-border bg-card p-5" aria-label="Usuário selecionado">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3"><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Users aria-hidden="true" className="size-5" /></div>
            <div className="min-w-0"><h2 className="break-words text-lg font-semibold">{selected.nome_completo}</h2><p className="break-all text-sm text-muted-foreground">{selected.email}</p></div>
          </div><StatusAcesso status={selected.status} />
        </div>
        <div className="flex items-start gap-2 border-t border-border pt-4 text-sm text-muted-foreground"><Building2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span className="min-w-0 break-words">{result.fundo.nome}</span></div>
      </section>
      <div className={cn('grid items-start gap-6', result.pode_editar && 'xl:grid-cols-[minmax(0,1fr)_380px]')}>
        <section className="min-w-0 space-y-4" aria-labelledby="sacado-empresas">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="sacado-empresas" className="font-semibold">Empresas vinculadas</h2><span className="text-sm text-muted-foreground">{ativos} de {result.acessos.length} CNPJs ativos</span></div>
          {result.acessos.length === 0 && <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center"><Building2 aria-hidden="true" className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="font-medium">Nenhuma empresa vinculada</p><p className="mt-1 text-sm text-muted-foreground">Este usuário ainda não possui acesso a CNPJs neste fundo.</p></div>}
          {result.acessos.map(a => <article key={a.id} className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-mono text-sm font-semibold">{formatCNPJ(a.cnpj)}</p><StatusAcesso status={a.status} /></div>
            <h3 className="mt-2 break-words text-sm font-medium">{a.razao_social}</h3>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Criado em {formatDate(a.created_at)} · Atualizado em {formatDate(a.updated_at)}</p>
            {result.pode_editar && <details className="group mt-4 border-t border-border pt-3">
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-md py-1 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">Gerenciar acesso<span className="sr-only"> ao CNPJ {formatCNPJ(a.cnpj)}</span><ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" /></summary>
              <div className="mt-3"><GestaoAcessoForm key={`${a.id}:${a.status}:${a.updated_at}`} usuario={selected.id} fundo={result.fundo.id} acesso={a} /></div>
            </details>}
          </article>)}
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck aria-hidden="true" className="size-4 shrink-0" />Somente vínculos ativos autorizam acesso. Desativar ou revogar preserva o histórico.</p>
        </section>
        {result.pode_editar && <aside className="min-w-0" aria-label="Adicionar empresa"><GestaoAcessoForm key={`${selected.id}:${result.fundo.id}`} usuario={selected.id} fundo={result.fundo.id} /></aside>}
      </div>
    </> : <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Usuários sacados">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-5"><h2 className="font-semibold">Usuários sacados</h2><span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{result.total} encontrado(s)</span></div>
      {result.usuarios.length === 0 ? <div className="px-5 py-12 text-center"><Search aria-hidden="true" className="mx-auto mb-3 size-8 text-muted-foreground" /><h3 className="font-medium">Nenhum sacado encontrado</h3><p className="mt-2 text-sm text-muted-foreground">Confira o fundo selecionado ou busque pelo e-mail completo.</p>{result.busca && <Link className={cn(outlineLink, 'mt-4')} href={`${basePath}?${new URLSearchParams({ fundo: result.fundo.id })}`}>Limpar busca</Link>}</div> : <>
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_140px_100px_150px] gap-4 bg-muted/40 px-5 py-3 text-xs font-medium text-muted-foreground lg:grid"><span>Usuário</span><span>CNPJs ativos</span><span>Status</span><span className="text-right">Acompanhamento</span></div>
        <div className="divide-y divide-border">{result.usuarios.map(u => <article key={u.id} className="grid gap-3 px-5 py-4 transition-colors hover:bg-muted/30 lg:grid-cols-[minmax(0,1fr)_140px_100px_150px] lg:items-center lg:gap-4">
          <div className="min-w-0"><h3 className="break-words text-sm font-semibold">{u.nome_completo}</h3><p className="mt-1 break-all text-sm text-muted-foreground">{u.email}</p></div>
          <p className="text-sm"><span className="font-semibold tabular-nums">{u.cnpjs_ativos}</span><span className="ml-1 text-muted-foreground">{u.cnpjs_ativos === 1 ? 'CNPJ ativo' : 'CNPJs ativos'}</span></p>
          <div><StatusAcesso status={u.status} /></div>
          <Link className={cn(outlineLink, 'justify-self-start lg:justify-self-end')} href={href(u.id)}>Abrir acessos<ArrowRight aria-hidden="true" /></Link>
        </article>)}</div>
      </>}
      <nav aria-label="Paginação dos sacados" className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 text-sm text-muted-foreground"><span>Página {result.pagina} de {paginas}</span>
        <div className="flex gap-2">{result.pagina > 1 && <Link className={outlineLink} href={href(null, result.pagina - 1)}><ChevronLeft aria-hidden="true" />Anterior</Link>}{result.pagina < paginas && <Link className={outlineLink} href={href(null, result.pagina + 1)}>Próxima<ChevronRight aria-hidden="true" /></Link>}</div>
      </nav>
    </section>}
  </PageContainer>
}
