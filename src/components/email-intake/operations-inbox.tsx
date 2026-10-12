import Link from 'next/link'
import { ArrowLeft, Inbox, ListFilter, Paperclip, Search } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button-variants'
import { carregarInboxEmail, carregarMensagemEmail } from '@/app/actions/email-operations'
import { emailHref, parseEmailInboxFilter, firstEmailParam, type EmailSearchParams } from '@/lib/email-intake/operations/navigation'
import { attachmentFeedback, emailDateLabel, emailErrorMessage, safeEmailErrorCode } from '@/lib/email-intake/operations/presentation'
import type { EmailDashboard } from '@/lib/email-intake/operations/contracts'
import { EmailReviewGuidance } from './review-guidance'
import { EmailMetadataButton } from './metadata-button'
import { EmailCedenteFilter } from './cedente-filter'
import { EmailStatusBadge } from './email-status-badge'
import { EmailInboxEmpty, EmailInboxRows } from './inbox-rows'

const selectClass = 'h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring'
const linkClass = buttonVariants({ variant: 'outline', className: 'min-h-10 px-4' })

export async function EmailOperationsInbox({ fundoId, basePath, params, dashboard }: {
  fundoId: string; basePath: string; params: EmailSearchParams; dashboard: EmailDashboard
}) {
  const review = firstEmailParam(params.tab) === 'review', parsed = parseEmailInboxFilter(params)
  if (!parsed.success) return <p role="alert">Há filtros inválidos. <Link className="underline" href={`${basePath}?fundo=${fundoId}&tab=${review ? 'review' : 'inbox'}`}>Limpar filtros e consultar novamente</Link></p>
  const result = await carregarInboxEmail(fundoId, parsed.data)
  return <section className="space-y-4" aria-label={review ? 'Pendências de revisão' : 'Importações por e-mail'}>
    <header><h2 className="text-xl font-semibold tracking-tight">{review ? 'Pendências de revisão' : 'Importações por e-mail'}</h2><p className="mt-1 text-sm text-muted-foreground">{review ? 'Abra uma mensagem para entender o motivo da revisão e orientar o responsável pela nota.' : 'Confira o que chegou à caixa e o resultado da importação de cada documento.'}</p></header>
    <form action={basePath} className="grid gap-4 rounded-xl border bg-card p-5 sm:grid-cols-2 xl:grid-cols-4 [&_label]:font-medium">
      <p className="flex items-center gap-2 text-sm font-semibold sm:col-span-2 xl:col-span-4"><ListFilter className="size-4 text-muted-foreground" aria-hidden="true" />Localizar mensagens</p>
      <input type="hidden" name="fundo" value={fundoId} /><input type="hidden" name="tab" value={review ? 'review' : 'inbox'} />
      <input type="hidden" name="status" value={parsed.data.status} />
      <label className="space-y-1 text-sm">Integração<select className={selectClass} name="filterIntegration" defaultValue={parsed.data.integrationId ?? ''}><option value="">Todas do fundo</option>{dashboard.integrations.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <label className="space-y-1 text-sm">Recebido a partir de<input className={selectClass} type="date" name="since" defaultValue={firstEmailParam(params.since)} /></label>
      <label className="space-y-1 text-sm">Recebido até<input className={selectClass} type="date" name="until" defaultValue={firstEmailParam(params.until)} /></label>
      <label className="space-y-1 text-sm">Itens por página<select className={selectClass} name="pageSize" defaultValue={parsed.data.pageSize}><option value="25">25</option><option value="50">50</option></select></label>
      <details className="rounded-lg border bg-muted/20 p-4 sm:col-span-2 xl:col-span-4" open={parsed.data.errorCode || parsed.data.documentType || parsed.data.cedenteId ? true : undefined}><summary className="cursor-pointer text-sm font-medium">Mais filtros: motivo, documento e cedente</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Motivo<select className={selectClass} name="errorCode" defaultValue={parsed.data.errorCode ?? ''}><option value="">Todos</option><option value="UNKNOWN_CEDENTE">Cedente não identificado</option><option value="ROUTING_DENIED">Cedente não autorizado</option><option value="AMBIGUOUS">Cedente ambíguo</option><option value="INVALID">Documento inválido</option><option value="AUTHENTICATION">Credencial recusada</option></select></label>
      <label className="space-y-1 text-sm">Tipo de documento<select className={selectClass} name="documentType" defaultValue={parsed.data.documentType ?? ''}><option value="">Todos</option><option value="NFE">NF-e</option><option value="NFSE">NFS-e</option></select></label>
      <EmailCedenteFilter fundoId={fundoId} initial={parsed.data.cedenteId} />
      </div></details>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 sm:col-span-2 xl:col-span-4"><p className="text-xs text-muted-foreground">As datas consideram o horário de Brasília.</p><div className="flex gap-2"><Link className={buttonVariants({ variant: 'ghost', className: 'min-h-10 px-4' })} href={`${basePath}?fundo=${fundoId}&tab=${review ? 'review' : 'inbox'}`}>Limpar</Link><button className={buttonVariants({ className: 'min-h-10 px-4' })} type="submit"><Search aria-hidden="true" />Aplicar filtros</button></div></div>
    </form>
    {!review && <nav className="flex flex-wrap gap-2" aria-label="Filtrar por resultado">{[['ALL', 'Todos'], ['REVIEW', 'Revisão'], ['ERROR', 'Erros'], ['IMPORTED', 'Importados'], ['DUPLICATE', 'Duplicados']].map(([status, label]) => <Link className={`${linkClass} ${parsed.data.status === status ? 'border-primary bg-primary/10' : ''}`} key={status} aria-current={parsed.data.status === status ? 'page' : undefined} href={emailHref(basePath, params, { status, page: null })}>{label}</Link>)}</nav>}
    <p className="flex items-center gap-2 text-sm text-muted-foreground"><Inbox className="size-4" aria-hidden="true" />{result.total} mensagem(ns) · Página {result.page}</p>
    <EmailMetadataButton fundoId={fundoId} ids={result.rows.filter(row => row.subject_preview === null).map(row => row.id)} />
    {!result.rows.length ? <EmailInboxEmpty review={review} /> : <EmailInboxRows rows={result.rows} basePath={basePath} params={params} />}
    <nav className="flex flex-wrap gap-3" aria-label="Páginas da inbox">{result.page > 1 && <Link className={linkClass} href={emailHref(basePath, params, { page: String(result.page - 1) })}>Anterior</Link>}{result.page * result.pageSize < result.total && <Link className={linkClass} href={emailHref(basePath, params, { page: String(result.page + 1) })}>Próxima</Link>}</nav>
  </section>
}

export async function EmailMessagePanel({ fundoId, basePath, params, messageId }: { fundoId: string; basePath: string; params: EmailSearchParams; messageId: string }) {
  const page = Number(firstEmailParam(params.attachmentPage) || 1)
  if (!Number.isInteger(page) || page < 1 || page > 1000) return <p role="alert">Página inválida. Volte à inbox para consultar os anexos.</p>
  const message = await carregarMensagemEmail(fundoId, messageId, page)
  return <section className="space-y-4">
    <Link className={linkClass} href={emailHref(basePath, params, { message: null, attachmentPage: null })}><ArrowLeft aria-hidden="true" />Voltar à inbox</Link>
    <header className="space-y-2 rounded-xl border bg-card p-5"><h2 className="text-xl font-semibold break-words">{message.subject || 'Assunto ainda não consultado'}</h2><p className="text-sm break-all">{message.sender || 'Remetente ainda não consultado'}</p><p className="text-sm text-muted-foreground">{message.integrationName} · Outlook · {emailDateLabel(message.receivedAt)}</p><p className="text-xs text-muted-foreground">Descoberta pela {message.discoverySource === 'RECONCILIATION' ? 'conferência automática' : 'leitura contínua'} · {message.total} anexo(s)</p></header>
    {!message.attachments.length && <p className="rounded border p-4">Nenhum anexo nesta página. Confira as demais páginas ou volte à inbox.</p>}
    <EmailMetadataButton fundoId={fundoId} ids={message.subject === null ? [message.id] : []} />
    {message.attachments.map(a => { const feedback = attachmentFeedback(a.status, a.last_error_code); return <article key={a.id} className="space-y-3 rounded-lg border bg-card p-4">
      <h3 className="flex items-start gap-2 font-semibold break-all"><Paperclip className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{a.file_name}</h3><EmailStatusBadge tone={feedback.tone}>{feedback.label}</EmailStatusBadge><p className="text-sm">{feedback.description}</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Cedente</dt><dd>{a.cedente_name || 'Ainda não identificado'}</dd></div><div><dt className="text-muted-foreground">Arquivo</dt><dd>{a.content_type} · {new Intl.NumberFormat('pt-BR').format(a.size_bytes)} bytes</dd></div><div><dt className="text-muted-foreground">Concluído em</dt><dd>{emailDateLabel(a.completed_at)}</dd></div></dl>
      {a.status === 'RETRY' && <p className="text-sm">Tentativas: {a.attempts} · Próxima tentativa: {emailDateLabel(a.available_at)}. {emailErrorMessage(a.last_error_code)}</p>}
      {a.nota_fiscal_id && basePath.startsWith('/gestor/') && <Link className={linkClass} href={`/gestor/notas-fiscais/${a.nota_fiscal_id}`}>Abrir nota fiscal vinculada</Link>}
      {a.review_available && <EmailReviewGuidance cedenteId={a.cedente_id} />}
      {a.status === 'REQUIRES_REVIEW' && !a.review_available && <p className="text-sm">A revisão não está mais disponível neste contexto. Atualize a página e confira o resultado com o responsável.</p>}
      <details className="text-sm"><summary className="cursor-pointer">Detalhes do processamento</summary><p className="mt-2">Identificação resumida do arquivo: {a.sha_preview || 'Ainda não calculada'} · Tentativas: {a.attempts}</p><p>Leitura: {a.parser_strategy?.includes('visual') || a.parser_strategy?.includes('vision') ? 'Reconhecimento visual' : a.parser_strategy === 'xml' ? 'XML' : a.parser_strategy ? 'Texto do documento' : 'Ainda não registrada'}</p><p>{emailErrorMessage(a.last_error_code)}</p><p>Código: {safeEmailErrorCode(a.last_error_code)}</p></details>
    </article> })}
    <nav className="flex gap-3" aria-label="Páginas de anexos">{page > 1 && <Link className={linkClass} href={emailHref(basePath, params, { attachmentPage: String(page - 1) })}>Anexos anteriores</Link>}{page * 25 < message.total && <Link className={linkClass} href={emailHref(basePath, params, { attachmentPage: String(page + 1) })}>Próximos anexos</Link>}</nav>
  </section>
}
