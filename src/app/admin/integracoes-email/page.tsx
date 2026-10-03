import Link from 'next/link'
import { z } from 'zod'
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
    <PageHeader title="Integrações de e-mail" description="Selecione o fundo para acompanhar as importações automáticas." />
    <form className="flex flex-wrap gap-2" action="/admin/integracoes-email">
      <label className="text-sm">Buscar fundo<input name="buscaFundo" defaultValue={busca} className="ml-2 rounded border bg-background px-3 py-2" maxLength={200} /></label>
      <button className="rounded border px-3 py-2 text-sm" type="submit">Buscar fundo</button>
    </form>
    <nav className="flex flex-wrap gap-3" aria-label="Fundos">{fundos.itens.map(f => <Link className="text-sm underline" aria-current={selected.success && selected.data === f.id ? 'page' : undefined} key={f.id} href={`/admin/integracoes-email?fundo=${f.id}`}>{f.nome}</Link>)}</nav>
    {!fundos.itens.length && <p className="text-sm">Nenhum fundo ativo encontrado. Confira a busca ou o cadastro de fundos.</p>}
    <nav className="flex gap-3 text-sm" aria-label="Páginas de fundos">
      {pagina > 1 && <Link className="underline" href={`?buscaFundo=${encodeURIComponent(busca)}&paginaFundo=${pagina - 1}`}>Fundos anteriores</Link>}
      {pagina < fundos.total_paginas && <Link className="underline" href={`?buscaFundo=${encodeURIComponent(busca)}&paginaFundo=${pagina + 1}`}>Próximos fundos</Link>}
    </nav>
    {currentFund && <p className="rounded-lg border bg-card p-3 font-semibold">Fundo selecionado: {currentFund.nome}</p>}
    {selected.success && !currentFund && <p role="alert">Fundo não encontrado. Selecione um fundo disponível na lista.</p>}
    {selected.success && currentFund && <Suspense fallback={<p role="status" className="animate-pulse rounded-lg border p-6">Carregando a operação de e-mail…</p>}>
      <EmailOperationsPage fundoId={selected.data} basePath="/admin/integracoes-email" params={params} />
    </Suspense>}
  </PageContainer>
}
