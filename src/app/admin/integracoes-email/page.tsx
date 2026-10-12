import Link from 'next/link'
import { z } from 'zod'
import { Building2, Check, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { listarAdminFundos, obterAdminFundo } from '@/lib/admin/fundos.server'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { Suspense } from 'react'
import { EmailOperationsPage } from '@/components/email-intake/operations-page'
import { firstEmailParam, type EmailSearchParams } from '@/lib/email-intake/operations/navigation'

export default async function AdminEmailHealthPage({ searchParams }: { searchParams: Promise<EmailSearchParams> }) {
  const params = await searchParams
  const selected = z.uuid().safeParse(firstEmailParam(params.fundo))
  const busca = firstEmailParam(params.buscaFundo) || ''
  const pagina = z.coerce.number().int().min(1).max(10000).catch(1).parse(firstEmailParam(params.paginaFundo) || 1)
  const fundos = await listarAdminFundos({ busca, status: 'ativos', pagina, porPagina: 20 })
  const currentFund = selected.success ? fundos.itens.find(f => f.id === selected.data) ?? await obterAdminFundo(selected.data) : null
  return <PageContainer className="space-y-5">
    <PageHeader title="Integrações de e-mail" eyebrow="Recebimento automático" description="Conecte uma caixa do Outlook, receba documentos fiscais e acompanhe as importações de cada fundo." />
    <section className="space-y-4 rounded-xl border bg-card p-5" aria-label="Seleção do fundo">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h2 className="font-semibold">Escolha o fundo</h2><p className="mt-1 text-sm text-muted-foreground">A configuração e as mensagens serão exibidas apenas para o fundo selecionado.</p></div><form className="flex items-end gap-2" action="/admin/integracoes-email">
      <label className="min-w-0 flex-1 space-y-2 text-sm font-medium">Buscar fundo<Input name="buscaFundo" defaultValue={busca} placeholder="Nome ou CNPJ" className="min-h-10" maxLength={200} /></label>
      <Button className="min-h-10 px-4" variant="outline" type="submit"><Search aria-hidden="true" />Buscar fundo</Button>
    </form></div>
    <nav className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Fundos">{fundos.itens.map(f => <Link className={`flex min-h-14 items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring ${selected.success && selected.data === f.id ? 'border-primary/30 bg-primary/5 text-primary' : 'hover:bg-muted'}`} aria-current={selected.success && selected.data === f.id ? 'page' : undefined} key={f.id} href={`/admin/integracoes-email?fundo=${f.id}`}><Building2 className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{f.nome}</span>{selected.success && selected.data === f.id && <Check className="ml-auto size-4 shrink-0" aria-hidden="true" />}</Link>)}</nav>
    {!fundos.itens.length && <p className="rounded-lg bg-muted/30 p-4 text-sm">Nenhum fundo ativo encontrado. Confira a busca ou o cadastro de fundos.</p>}
    <nav className="flex gap-3 text-sm" aria-label="Páginas de fundos">
      {pagina > 1 && <Link className="underline" href={`?buscaFundo=${encodeURIComponent(busca)}&paginaFundo=${pagina - 1}`}>Fundos anteriores</Link>}
      {pagina < fundos.total_paginas && <Link className="underline" href={`?buscaFundo=${encodeURIComponent(busca)}&paginaFundo=${pagina + 1}`}>Próximos fundos</Link>}
    </nav>
    </section>
    {currentFund && <p className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-medium"><Building2 className="size-4 shrink-0 text-primary" aria-hidden="true" />Fundo selecionado: {currentFund.nome}</p>}
    {!selected.success && !params.fundo && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Selecione um fundo acima para criar ou gerenciar suas integrações.</p>}
    {selected.success && !currentFund && <p role="alert">Fundo não encontrado. Selecione um fundo disponível na lista.</p>}
    {selected.success && currentFund && <Suspense fallback={<p role="status" className="animate-pulse rounded-lg border p-6">Carregando a operação de e-mail…</p>}>
      <EmailOperationsPage fundoId={selected.data} basePath="/admin/integracoes-email" params={params} />
    </Suspense>}
  </PageContainer>
}
