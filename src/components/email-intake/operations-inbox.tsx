import Link from 'next/link'
import { carregarInboxEmail, carregarMensagemEmail } from '@/app/actions/email-operations'
import { emailHref, parseEmailInboxFilter, firstEmailParam, type EmailSearchParams } from '@/lib/email-intake/operations/navigation'
import { attachmentFeedback, emailDateLabel, emailErrorMessage, safeEmailErrorCode } from '@/lib/email-intake/operations/presentation'
import type { EmailDashboard } from '@/lib/email-intake/operations/contracts'
import { EmailReviewGuidance } from './review-guidance'
import { EmailMetadataButton } from './metadata-button'
import { EmailCedenteFilter } from './cedente-filter'

const selectClass = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm'
const linkClass = 'inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring'
const attentionClass = 'border-amber-500/70 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100'
const errorClass = 'border-red-600 bg-red-50 text-red-800 dark:border-red-500 dark:bg-red-950/40 dark:text-red-200'
const neutralClass = 'border-border bg-muted text-muted-foreground'

export async function EmailOperationsInbox({ fundoId, basePath, params, dashboard }: {
  fundoId: string; basePath: string; params: EmailSearchParams; dashboard: EmailDashboard
}) {
  const review = firstEmailParam(params.tab) === 'review', parsed = parseEmailInboxFilter(params)
  if (!parsed.success) return <p role="alert">Há filtros inválidos. <Link className="underline" href={`${basePath}?fundo=${fundoId}&tab=${review ? 'review' : 'inbox'}`}>Limpar filtros e consultar novamente</Link></p>
  const result = await carregarInboxEmail(fundoId, parsed.data)
  return <section className="space-y-4" aria-label={review ? 'Pendências de revisão' : 'Importações por e-mail'}>
    <h2 className="text-lg font-semibold">{review ? 'Pendências de revisão' : 'Importações por e-mail'}</h2>
    {review && <p className="text-sm text-muted-foreground">Acompanhe os documentos que aguardam o responsável. Abra uma mensagem para ver o motivo e acessar as orientações do fluxo oficial.</p>}
    <form action={basePath} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 xl:grid-cols-4">
      <input type="hidden" name="fundo" value={fundoId} /><input type="hidden" name="tab" value={review ? 'review' : 'inbox'} />
      <input type="hidden" name="status" value={parsed.data.status} />
      <label className="space-y-1 text-sm">Integração<select className={selectClass} name="filterIntegration" defaultValue={parsed.data.integrationId ?? ''}><option value="">Todas do fundo</option>{dashboard.integrations.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <label className="space-y-1 text-sm">Recebido a partir de<input className={selectClass} type="date" name="since" defaultValue={firstEmailParam(params.since)} /></label>
      <label className="space-y-1 text-sm">Recebido até<input className={selectClass} type="date" name="until" defaultValue={firstEmailParam(params.until)} /></label>
      <label className="space-y-1 text-sm">Itens por página<select className={selectClass} name="pageSize" defaultValue={parsed.data.pageSize}><option value="25">25</option><option value="50">50</option></select></label>
      <label className="space-y-1 text-sm">Motivo<select className={selectClass} name="errorCode" defaultValue={parsed.data.errorCode ?? ''}><option value="">Todos</option><option value="UNKNOWN_CEDENTE">Cedente não identificado</option><option value="ROUTING_DENIED">Cedente não autorizado</option><option value="AMBIGUOUS">Cedente ambíguo</option><option value="INVALID">Documento inválido</option><option value="AUTHENTICATION">Credencial recusada</option></select></label>
      <label className="space-y-1 text-sm">Tipo de documento<select className={selectClass} name="documentType" defaultValue={parsed.data.documentType ?? ''}><option value="">Todos</option><option value="NFE">NF-e</option><option value="NFSE">NFS-e</option></select></label>
      <EmailCedenteFilter fundoId={fundoId} initial={parsed.data.cedenteId} />
      <div className="flex flex-wrap items-end gap-2"><button className={linkClass} type="submit">Aplicar filtros</button><Link className={linkClass} href={`${basePath}?fundo=${fundoId}&tab=${review ? 'review' : 'inbox'}`}>Limpar</Link></div>
      <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">Datas no horário de Brasília. Conteúdo do e-mail e identificadores do provedor não são exibidos.</p>
    </form>
    {!review && <nav className="flex flex-wrap gap-2" aria-label="Filtrar por resultado">{[['ALL', 'Todos'], ['REVIEW', 'Revisão'], ['ERROR', 'Erros'], ['IMPORTED', 'Importados'], ['DUPLICATE', 'Duplicados']].map(([status, label]) => <Link className={`${linkClass} ${parsed.data.status === status ? 'border-primary bg-primary/10' : ''}`} key={status} aria-current={parsed.data.status === status ? 'page' : undefined} href={emailHref(basePath, params, { status, page: null })}>{label}</Link>)}</nav>}
    <p className="text-sm text-muted-foreground">{result.total} mensagem(ns) · Página {result.page}</p>
    <EmailMetadataButton fundoId={fundoId} ids={result.rows.filter(row => row.subject_preview === null).map(row => row.id)} />
    {!result.rows.length && <div className="rounded-lg border p-6"><p>{review ? 'Não há documentos aguardando revisão nestes filtros.' : 'Nenhuma mensagem encontrada nestes filtros.'}</p><p className="mt-2 text-sm text-muted-foreground">{review ? 'Acompanhe a inbox para conferir novas importações.' : 'Confira os filtros, a ativação da integração e sua data inicial de leitura.'}</p></div>}
    <div className="grid gap-3 lg:grid-cols-2">{result.rows.map(row => <article className="min-w-0 space-y-3 rounded-lg border bg-card p-4" key={row.id}>
      <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-medium break-words">{row.subject_preview || 'Assunto ainda não consultado'}</h3><span className={`rounded border px-2 py-1 text-xs font-semibold ${row.review ? attentionClass : row.errors ? errorClass : neutralClass}`}>{row.review ? 'Em revisão' : row.errors ? 'Requer atenção' : row.pending ? 'Em processamento' : row.imported ? 'Importado' : row.duplicates ? 'Duplicado' : 'Recebido'}</span></div>
      <p className="text-sm text-muted-foreground">{emailDateLabel(row.received_at)} · {row.integration_name} · Outlook</p>
      <p className="text-sm break-all">{row.sender_masked || 'Remetente ainda não consultado'}</p>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">{[['Anexos', row.attachment_count], ['Importados', row.imported], ['Duplicados', row.duplicates], ['Em revisão', row.review], ['Requerem atenção', row.errors], ['Aguardando', row.pending]].map(([label, count]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{count}</dd></div>)}</dl>
      <Link className={linkClass} href={emailHref(basePath, params, { message: row.id, attachmentPage: null })}>Abrir mensagem{row.review ? ' e pendências' : ''}</Link>
    </article>)}</div>
    <nav className="flex flex-wrap gap-3" aria-label="Páginas da inbox">{result.page > 1 && <Link className={linkClass} href={emailHref(basePath, params, { page: String(result.page - 1) })}>Anterior</Link>}{result.page * result.pageSize < result.total && <Link className={linkClass} href={emailHref(basePath, params, { page: String(result.page + 1) })}>Próxima</Link>}</nav>
  </section>
}

export async function EmailMessagePanel({ fundoId, basePath, params, messageId }: { fundoId: string; basePath: string; params: EmailSearchParams; messageId: string }) {
  const page = Number(firstEmailParam(params.attachmentPage) || 1)
  if (!Number.isInteger(page) || page < 1 || page > 1000) return <p role="alert">Página inválida. Volte à inbox para consultar os anexos.</p>
  const message = await carregarMensagemEmail(fundoId, messageId, page)
  return <section className="space-y-4">
    <Link className={linkClass} href={emailHref(basePath, params, { message: null, attachmentPage: null })}>Voltar à inbox</Link>
    <header className="space-y-2 rounded-lg border p-4"><h2 className="text-lg font-semibold break-words">{message.subject || 'Assunto ainda não consultado'}</h2><p className="text-sm break-all">{message.sender || 'Remetente ainda não consultado'}</p><p className="text-sm text-muted-foreground">{message.integrationName} · Outlook · {emailDateLabel(message.receivedAt)}</p><p className="text-xs text-muted-foreground">Descoberta pela {message.discoverySource === 'RECONCILIATION' ? 'conferência automática' : 'leitura contínua'} · {message.total} anexo(s)</p></header>
    {!message.attachments.length && <p className="rounded border p-4">Nenhum anexo nesta página. Confira as demais páginas ou volte à inbox.</p>}
    <EmailMetadataButton fundoId={fundoId} ids={message.subject === null ? [message.id] : []} />
    {message.attachments.map(a => { const feedback = attachmentFeedback(a.status, a.last_error_code); return <article key={a.id} className="space-y-3 rounded-lg border bg-card p-4">
      <h3 className="font-semibold break-all">{a.file_name}</h3><p className={`w-fit rounded border px-2 py-1 font-medium ${feedback.tone === 'attention' ? attentionClass : feedback.tone === 'error' ? errorClass : neutralClass}`}>{feedback.label}</p><p className="text-sm">{feedback.description}</p>
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
