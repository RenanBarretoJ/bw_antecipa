'use client'

import Link from 'next/link'
import { Bell, Check, CheckCheck } from 'lucide-react'
import { buildListUrl } from '@/lib/pagination'
import { NOTIFICACAO_FILTROS, type NotificacaoFiltro } from '@/lib/notificacoes/contracts'
import { LoadMoreButton } from '@/components/pagination/LoadMoreButton'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { NotificacoesContextControl, useNotificacoesContexto } from './notificacoes-context'
import { useNotificacoes } from './use-notificacoes'
import { useNotificacaoItemFocus } from './use-notificacao-item-focus'

export function NotificacoesPageClient({ initialFilter, basePath }: { initialFilter: NotificacaoFiltro; basePath: string }) {
  const { escopo, loading: contextoLoading } = useNotificacoesContexto()
  const { page, loading, more, busy, error, mark, loadMore, retry } = useNotificacoes(initialFilter, 20)
  const { rootRef, onFocusCapture } = useNotificacaoItemFocus(page.items.map((item) => item.id))
  const counts = page.contadores ?? { total: 0, naoLidas: 0 }
  return <section className="mx-auto w-full max-w-4xl space-y-5 px-4 pb-8 sm:px-6" aria-labelledby="notificacoes-title">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div className="min-w-0 space-y-2">
        <h1 id="notificacoes-title" className="text-2xl font-bold text-foreground">Notificações</h1>
        <NotificacoesContextControl />
      </div>
      <Button variant="outline" size="sm" onClick={() => void mark(null)} disabled={!escopo || busy || loading || counts.naoLidas === 0} className="shrink-0 gap-2">
        <CheckCheck className="size-4" aria-hidden="true" />{busy ? 'Marcando…' : 'Marcar todas como lidas'}
      </Button>
    </div>
    <p className="text-sm text-muted-foreground" role="status">{contextoLoading || loading ? 'Atualizando notificações…' : `${counts.naoLidas} não lidas neste contexto · ${counts.total} no total`}</p>
    <nav className="flex flex-wrap gap-1 border-b border-border pb-2" aria-label="Filtros de notificações">
      {(Object.entries(NOTIFICACAO_FILTROS) as Array<[NotificacaoFiltro, string]>).map(([key, label]) => <Link key={key}
        href={buildListUrl(basePath, undefined, { filtro: key === 'todas' ? null : key, cursor: null }, { pageParam: 'cursor', resetPageOn: ['filtro'] })}
        aria-current={initialFilter === key ? 'page' : undefined}
        className={cn('rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary', initialFilter === key ? 'bg-blue-700 text-white dark:bg-blue-300 dark:text-slate-950' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
        {label}
      </Link>)}
    </nav>
    {error && <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error} <button type="button" className="underline" onClick={retry}>Tentar novamente</button></div>}
    {!contextoLoading && !loading && !error && page.items.length === 0 && <Card><CardContent className="flex flex-col items-center gap-3 py-14 text-center">
      <Bell className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="font-semibold">{escopo?.scope === 'GLOBAL' ? 'Nenhum aviso geral de segurança.' : 'Nenhuma notificação para este Fundo.'}</p>
      <p className="text-sm text-muted-foreground">Os avisos respeitam o contexto selecionado e seus acessos atuais.</p>
    </CardContent></Card>}
    <div ref={rootRef} onFocusCapture={onFocusCapture} tabIndex={-1} aria-label="Notificações do contexto atual" className="rounded-lg focus-visible:outline-2 focus-visible:outline-primary">
    <ul className="space-y-3" aria-label="Lista de notificações" aria-busy={loading || contextoLoading}>
      {page.items.map((item) => <li key={item.id} data-notificacao-id={item.id}><Card className={cn(!item.lida && 'border-primary/30 bg-primary/[0.03]')}>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-col justify-between gap-2 sm:flex-row">
            <h2 className="min-w-0 break-words text-sm font-semibold">{item.titulo}{!item.lida && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-900 dark:text-blue-200">Não lida</span>}</h2>
            <time dateTime={item.createdAt} className="shrink-0 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</time>
          </div>
          <p className="break-words text-sm leading-relaxed text-muted-foreground">{item.mensagem}</p>
          <div className="flex flex-wrap justify-end gap-2">
            {item.href && <Button render={<Link href={item.href} prefetch={false} />} nativeButton={false} variant="outline" size="sm" className="text-blue-700 dark:text-blue-200">Abrir detalhe<span className="sr-only">: {item.titulo}</span></Button>}
            {!item.lida && <Button variant="ghost" size="sm" aria-disabled={busy || loading} onClick={() => { if (!busy && !loading) void mark(item.id) }}><Check className="mr-1 size-4" aria-hidden="true" />Marcar como lida<span className="sr-only">: {item.titulo}</span></Button>}
          </div>
        </CardContent>
      </Card></li>)}
    </ul>
    </div>
    <LoadMoreButton hasMore={Boolean(page.nextCursor)} loading={more || loading} onLoadMore={loadMore} error={null} />
  </section>
}
