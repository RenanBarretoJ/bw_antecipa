import Link from 'next/link'
import { EmptyState, StatusBadge } from '@/components/data-display/primitives'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { listarAdminWebhookEventosTransportadora } from '@/lib/admin/integracoes-transportadoras.server'
import { parseAdminWebhookEventosFiltro, WEBHOOK_EVENTO_STATUSES, type AdminWebhookEventosFiltro } from '@/lib/admin/integracoes-transportadoras'
import { formatDateTimeSaoPaulo } from '@/lib/utils'

const outlineLink = 'inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted'
const inputClass = 'h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm'

function pageHref(filtro: AdminWebhookEventosFiltro, pagina: number) {
  const params = new URLSearchParams()
  if (filtro.fundoId) params.set('fundoId', filtro.fundoId)
  if (filtro.integracaoId) params.set('integracaoId', filtro.integracaoId)
  if (filtro.status) params.set('status', filtro.status)
  if (filtro.chaveNfe) params.set('chaveNfe', filtro.chaveNfe)
  if (filtro.chaveCte) params.set('chaveCte', filtro.chaveCte)
  if (filtro.desde) params.set('desde', filtro.desde)
  if (filtro.ate) params.set('ate', filtro.ate)
  params.set('pagina', String(pagina))
  return `/admin/integracoes-transportadoras/eventos?${params}`
}

export default async function AdminWebhookEventosTransportadoraPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const filtro = parseAdminWebhookEventosFiltro(await searchParams)
  const result = await listarAdminWebhookEventosTransportadora(filtro)
  const totalPaginas = Math.max(1, Math.ceil(result.total / result.limit))

  return (
    <PageContainer className="space-y-5">
      <PageHeader
        eyebrow="Logistica"
        title="Eventos do webhook de transportadora"
        description="Observabilidade dos comprovantes de entrega recebidos via webhook -- nunca exibe Base64 ou token."
      />

      <form method="get" className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm md:grid-cols-5">
        {filtro.integracaoId && <input type="hidden" name="integracaoId" value={filtro.integracaoId} />}
        <select name="status" defaultValue={filtro.status || ''} className={inputClass}>
          <option value="">Todos os status</option>
          {WEBHOOK_EVENTO_STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
        <input name="chaveNfe" defaultValue={filtro.chaveNfe || ''} placeholder="Chave NF-e" className={inputClass} />
        <input name="chaveCte" defaultValue={filtro.chaveCte || ''} placeholder="Chave CT-e" className={inputClass} />
        <input type="date" name="desde" defaultValue={filtro.desde || ''} className={inputClass} />
        <button type="submit" className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">Filtrar</button>
      </form>

      <p className="text-sm text-muted-foreground">{result.total} evento(s) encontrado(s){filtro.integracaoId ? ' para esta integracao' : ''}</p>

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {result.items.length === 0 ? (
          <EmptyState title="Nenhum evento encontrado" description="Ajuste os filtros de busca." />
        ) : (
          <div className="divide-y divide-border">
            {result.items.map((evento) => (
              <Link
                key={evento.id}
                href={`/admin/integracoes-transportadoras/eventos/${evento.id}`}
                className="grid items-center gap-3 px-4 py-3 hover:bg-muted/40 sm:grid-cols-[140px_minmax(0,1fr)_160px]"
              >
                <span className="text-xs text-muted-foreground">{formatDateTimeSaoPaulo(evento.recebido_em)}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm">{evento.chave_nfe || evento.chave_cte || '(sem chave)'}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {evento.provider}{evento.erro_detalhe ? ` • ${evento.erro_detalhe}` : ''}
                  </p>
                </div>
                <StatusBadge status={evento.status} label={evento.status} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <nav className="flex items-center justify-between gap-3" aria-label="Paginacao">
        <span className="text-sm text-muted-foreground">Pagina {filtro.pagina} de {totalPaginas}</span>
        <div className="flex gap-2">
          {filtro.pagina > 1 ? <Link className={outlineLink} href={pageHref(filtro, filtro.pagina - 1)}>Anterior</Link> : <span className={`${outlineLink} pointer-events-none opacity-50`}>Anterior</span>}
          {filtro.pagina < totalPaginas ? <Link className={outlineLink} href={pageHref(filtro, filtro.pagina + 1)}>Proxima</Link> : <span className={`${outlineLink} pointer-events-none opacity-50`}>Proxima</span>}
        </div>
      </nav>
    </PageContainer>
  )
}
