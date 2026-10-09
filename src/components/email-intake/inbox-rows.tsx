import Link from 'next/link'
import { ArrowRight, Inbox } from 'lucide-react'
import type { EmailInbox } from '@/lib/email-intake/operations/contracts'
import { emailDateLabel, inboxRowFeedback } from '@/lib/email-intake/operations/presentation'
import { emailHref, type EmailSearchParams } from '@/lib/email-intake/operations/navigation'
import { EmailStatusBadge } from './email-status-badge'

/** The list stays server-rendered; its only interaction is ordinary accessible navigation. */
export function EmailInboxRows({ rows, basePath, params }: { rows: EmailInbox['rows']; basePath: string; params: EmailSearchParams }) {
  return <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
    <div aria-hidden="true" className="hidden grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1.8fr)_7rem_12rem_5rem] gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground lg:grid">
      <span>Recebido</span><span>Remetente</span><span>Assunto</span><span>Anexos</span><span>Processamento</span><span>Ação</span>
    </div>
    <ul aria-label="Mensagens recebidas" className="divide-y">
      {rows.map(row => {
        const feedback = inboxRowFeedback(row)
        const subject = row.subject_preview || 'Assunto ainda não consultado'
        return <li key={row.id}>
          <Link href={emailHref(basePath, params, { message: row.id, attachmentPage: null })} prefetch={false}
            aria-label={`Ver detalhe: ${subject}. ${feedback.label}. Recebido ${emailDateLabel(row.received_at)}. ${row.sender_masked || 'Remetente ainda não consultado'}. ${row.attachment_count} anexos.`}
            aria-current={params.message === row.id ? 'page' : undefined}
            className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-muted/40 aria-[current=page]:border-l-2 aria-[current=page]:border-primary aria-[current=page]:bg-muted/40 focus-visible:relative focus-visible:z-10 focus-visible:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring md:grid-cols-[8.5rem_minmax(0,1fr)_12rem] md:items-center lg:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1.8fr)_7rem_12rem_5rem]">
            <span className="col-start-2 row-start-1 text-xs tabular-nums text-muted-foreground md:col-start-1 lg:col-start-auto lg:row-start-auto">{emailDateLabel(row.received_at)}</span>
            <span title={row.sender_masked || undefined} className="col-span-2 row-start-2 min-w-0 truncate text-xs text-muted-foreground md:col-span-1 md:col-start-2 lg:col-start-auto lg:row-start-auto">{row.sender_masked || 'Remetente ainda não consultado'}</span>
            <span title={subject} className="col-span-2 row-start-3 min-w-0 truncate font-medium md:col-span-1 md:col-start-2 md:row-start-1 lg:col-start-auto lg:row-start-auto">{subject}</span>
            <span aria-label={`${row.attachment_count} anexos`} className="col-start-1 row-start-4 flex min-w-0 flex-wrap items-center gap-1 md:row-start-2 lg:col-start-auto lg:row-start-auto">
              {row.attachment_types.map(type => <span key={type} className="rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium">{type === 'OUTRO' ? 'Outro' : type}</span>)}
              {!row.attachment_types.length && <span className="text-xs text-muted-foreground">{row.attachment_count} anexos</span>}
            </span>
            <span title={feedback.description} className="col-start-1 row-start-1 min-w-0 md:col-start-3 md:row-span-2 lg:col-start-auto lg:row-span-1 lg:row-start-auto"><EmailStatusBadge tone={feedback.tone}>{feedback.label}</EmailStatusBadge></span>
            <span className="col-start-2 row-start-4 flex items-center gap-1 text-xs font-medium text-primary md:row-start-3 lg:col-start-auto lg:row-start-auto">Ver detalhe<ArrowRight className="size-3.5" aria-hidden="true" /></span>
          </Link>
        </li>
      })}
    </ul>
  </div>
}

export function EmailInboxRowsLoading() {
  return <div role="status" aria-label="Carregando mensagens" className="min-w-0 overflow-hidden rounded-lg border bg-card">
    {[0, 1, 2, 3, 4].map(index => <div aria-hidden="true" key={index} className="flex h-16 items-center gap-4 border-b px-4 last:border-0"><span className="h-3 w-20 animate-pulse rounded bg-muted" /><span className="h-3 min-w-0 flex-1 animate-pulse rounded bg-muted" /><span className="h-5 w-24 animate-pulse rounded bg-muted" /></div>)}
    <span className="sr-only">Carregando mensagens</span>
  </div>
}

export function EmailInboxEmpty({ review }: { review: boolean }) {
  return <div className="flex items-start gap-3 rounded-lg border border-dashed bg-card p-4">
    <Inbox className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    <div><p className="text-sm font-medium">{review ? 'Não há documentos aguardando revisão nestes filtros.' : 'Nenhuma mensagem encontrada nestes filtros.'}</p><p className="mt-1 text-xs text-muted-foreground">{review ? 'Acompanhe a inbox para conferir novas importações.' : 'Confira os filtros, a ativação da integração e sua data inicial de leitura.'}</p></div>
  </div>
}
