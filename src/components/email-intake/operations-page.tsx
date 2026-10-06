import Link from 'next/link'
import { z } from 'zod'
import { ArrowLeft, ArrowRight, Mail, Plus, Settings2, Inbox, ClipboardCheck, CheckCircle2, Radio, AlertCircle } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button-variants'
import { carregarOperacaoEmail } from '@/app/actions/email-operations'
import { emailHref, firstEmailParam, type EmailSearchParams } from '@/lib/email-intake/operations/navigation'
import { emailDateLabel, emailErrorMessage } from '@/lib/email-intake/operations/presentation'
import { EmailConfigurationWizard } from './configuration-wizard'
import { EmailCredentialEntry } from './credential-entry'
import { EmailIntegrationCommands } from './integration-commands'
import { EmailOperationalHealth, emailConfigLabels, emailHealthLabel } from './operational-health'
import { EmailMessagePanel, EmailOperationsInbox } from './operations-inbox'
import { EmailStatusBadge } from './email-status-badge'

const linkClass = buttonVariants({ variant: 'outline', className: 'min-h-10 px-4' })

export async function EmailOperationsPage({ fundoId, basePath, params }: { fundoId: string; basePath: string; params: EmailSearchParams }) {
  const current = { ...params, fundo: fundoId }, dashboard = await carregarOperacaoEmail(fundoId)
  const tab = firstEmailParam(params.tab) || 'integrations', integration = firstEmailParam(params.integration), message = firstEmailParam(params.message)
  const row = dashboard.integrations.find(i => i.id === integration), creating = firstEmailParam(params.new) === '1', editing = firstEmailParam(params.edit) === '1'
  const root = `${basePath}?fundo=${fundoId}`
  const activeCount = dashboard.integrations.filter(i => i.enabled).length
  const alertCount = dashboard.integrations.reduce((count, i) => count + i.alerts.filter(a => a.active).length, 0)
  return <div className="min-w-0 space-y-5 dark:[--primary:oklch(0.48_0.19_259)]">
    <nav className="flex flex-wrap gap-1 rounded-xl border bg-muted/30 p-1.5" aria-label="Operação de e-mail">{[
      { key: 'integrations', label: 'Integrações', icon: Settings2 },
      { key: 'inbox', label: 'Importações por e-mail', icon: Inbox },
      { key: 'review', label: 'Pendências de revisão', icon: ClipboardCheck },
    ].map(({ key, label, icon: Icon }) => <Link key={key} className={buttonVariants({ variant: tab === key ? 'outline' : 'ghost', className: `h-auto min-h-11 flex-1 gap-2 px-4 py-2.5 sm:flex-none ${tab === key ? 'bg-card text-primary shadow-sm dark:text-blue-300' : 'text-muted-foreground'}` })} aria-current={tab === key ? 'page' : undefined} href={`${root}&tab=${key}`}><Icon className="size-4" aria-hidden="true" />{label}</Link>)}</nav>
    {creating || (editing && row && !row.enabled) ? <><Link className={buttonVariants({ variant: 'ghost', className: 'min-h-10' })} href={root}><ArrowLeft aria-hidden="true" />Voltar às integrações</Link><EmailConfigurationWizard key={row?.id || 'new'} fundoId={fundoId} basePath={basePath} dashboard={dashboard} initial={creating ? undefined : row} /></>
      : tab === 'inbox' || tab === 'review' ? message && z.uuid().safeParse(message).success ? <EmailMessagePanel fundoId={fundoId} basePath={basePath} params={current} messageId={message} />
        : <EmailOperationsInbox fundoId={fundoId} basePath={basePath} params={current} dashboard={dashboard} />
      : integration ? row ? <article className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><Link className={linkClass} href={root}>Voltar às integrações</Link>{!row.enabled && <Link className={linkClass} href={emailHref(basePath, current, { edit: '1' })}>Editar configuração</Link>}</div>
        <header className="flex items-start gap-4"><div className="rounded-xl bg-primary/10 p-3 text-primary"><Mail className="size-6" aria-hidden="true" /></div><div className="min-w-0"><h2 className="text-2xl font-semibold tracking-tight break-words">{row.name}</h2><p className="mt-1 text-sm text-muted-foreground break-all">{row.mailbox || 'Caixa ainda não definida'} · Microsoft Outlook</p><div className="mt-3"><EmailStatusBadge tone={row.configStatus === 'ACTIVE' ? 'success' : row.configStatus === 'ERROR' ? 'error' : 'neutral'}>{emailConfigLabels[row.configStatus]}</EmailStatusBadge></div></div></header>
        <dl className="grid gap-5 rounded-xl bg-muted/30 p-5 text-sm sm:grid-cols-2 [&_dd]:mt-1 [&_dd]:font-medium"><div><dt className="text-muted-foreground">Ambiente</dt><dd>{row.environment === 'homologacao' ? 'Homologação' : 'Produção'}</dd></div><div><dt className="text-muted-foreground">Documentos aceitos</dt><dd>{row.routingMode === 'ALLOWLIST' ? `${row.cedenteIds.length} cedente(s) selecionado(s)` : 'Todos os cedentes ativos deste fundo'}</dd></div><div><dt className="text-muted-foreground">Data inicial de leitura · Brasília</dt><dd>{emailDateLabel(row.startAt)}</dd></div><div><dt className="text-muted-foreground">Credencial</dt><dd>{dashboard.credentials.find(c => c.id === row.credentialId)?.name ?? (row.credentialId ? 'Indisponível — confira com o administrador' : 'Não vinculada ao cofre')}</dd></div><div><dt className="text-muted-foreground">Último teste de conexão</dt><dd>{emailDateLabel(row.testCompletedAt)}{row.testCompletedAt ? row.testErrorCode ? ' · Falhou' : ' · Aprovado' : ''}</dd></div></dl>
        {row.testErrorCode && <p className="text-sm" role="status">{emailErrorMessage(row.testErrorCode)}</p>}
        <p className="text-sm text-muted-foreground">E-mails anteriores à data inicial não serão importados. O CNPJ do documento determina o cedente; o remetente não define o vínculo.</p>
        {row.enabled && <p className="text-sm">Para editar a configuração, desative a integração e aguarde os processamentos em andamento.</p>}
        <EmailIntegrationCommands fundoId={fundoId} row={row} />
        <EmailOperationalHealth row={row} />
        <Link className={linkClass} href={`${root}&tab=inbox&filterIntegration=${row.id}`}><Inbox aria-hidden="true" />Ver mensagens desta integração<ArrowRight aria-hidden="true" /></Link>
      </article> : <p role="alert">Integração não disponível neste fundo. <Link className="underline" href={root}>Voltar à lista</Link></p>
      : <>
        <div className="grid gap-3 sm:grid-cols-3">{[
          { label: 'Caixas cadastradas', value: dashboard.integrations.length, icon: Mail },
          { label: 'Integrações ativas', value: activeCount, icon: Radio },
          { label: 'Alertas ativos', value: alertCount, icon: AlertCircle },
        ].map(({ label, value, icon: Icon }) => <div key={label} className="flex items-center gap-4 rounded-xl border bg-card p-5"><span className="rounded-lg bg-muted p-2.5 text-muted-foreground"><Icon className="size-5" aria-hidden="true" /></span><div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div></div>)}</div>
        <section className="rounded-xl border border-primary/20 bg-primary/5 p-5 sm:p-6" aria-label="Como começar">
          <h2 className="font-semibold">Receba documentos fiscais direto do e-mail</h2><p className="mt-1 text-sm text-muted-foreground">Configure uma caixa do Outlook e acompanhe cada documento recebido neste fundo.</p>
          <ol className="mt-5 grid gap-4 text-sm sm:grid-cols-3">{[
            ['Defina a caixa', 'Informe a conta, a credencial e os cedentes permitidos.'],
            ['Teste a conexão', 'Confira se a plataforma consegue acessar a caixa.'],
            ['Ative e acompanhe', 'Veja os resultados em Importações por e-mail e as pendências em Revisão.'],
          ].map(([title, description], index) => <li key={title} className="flex items-start gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background font-semibold text-primary">{index + 1}</span><div><p className="font-medium">{title}</p><p className="mt-1 text-muted-foreground">{description}</p></div></li>)}</ol>
        </section>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h2 className="text-lg font-semibold">Suas integrações</h2><p className="mt-1 text-sm text-muted-foreground">Gerencie a leitura automática e confira a situação de cada caixa.</p></div><div className="flex flex-wrap items-start gap-2"><Link className={buttonVariants({ className: 'min-h-10 gap-2 px-4' })} href={`${root}&new=1`}><Plus aria-hidden="true" />Criar integração</Link>{dashboard.canManageCredentials && <EmailCredentialEntry fundoId={fundoId} />}</div></div>
        {!dashboard.integrations.length && <div className="flex flex-col items-center rounded-xl border border-dashed bg-card px-6 py-12 text-center"><span className="mb-4 rounded-full bg-muted p-4"><Mail className="size-8 text-muted-foreground" aria-hidden="true" /></span><h3 className="font-semibold">Nenhuma integração de e-mail cadastrada.</h3><p className="mt-2 max-w-md text-sm text-muted-foreground">Comece em Criar integração. Você pode salvar um rascunho e completar a configuração depois.</p></div>}
        <div className="grid gap-4 xl:grid-cols-2">{dashboard.integrations.map(i => <article key={i.id} className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md">
          <div className="space-y-4 p-5 sm:p-6"><header className="flex items-start gap-3"><span className="rounded-lg bg-muted p-2.5 text-primary"><Mail className="size-5" aria-hidden="true" /></span><div className="min-w-0"><h3 className="text-lg font-semibold break-words">{i.name}</h3><p className="mt-1 text-sm text-muted-foreground break-all">{i.mailbox || 'Caixa ainda não definida'}</p><p className="mt-1 text-xs text-muted-foreground">Microsoft Outlook · {i.environment === 'homologacao' ? 'Homologação' : 'Produção'}</p></div></header>
          <div className="flex flex-wrap gap-2"><EmailStatusBadge tone={i.configStatus === 'ACTIVE' ? 'success' : i.configStatus === 'ERROR' ? 'error' : 'neutral'}>{emailConfigLabels[i.configStatus]}</EmailStatusBadge><EmailStatusBadge tone={!i.enabled || !i.healthCheckedAt ? 'neutral' : i.healthStatus === 'HEALTHY' ? 'success' : i.healthStatus === 'ERROR' ? 'error' : 'attention'}>{emailHealthLabel(i)}</EmailStatusBadge></div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Cedentes</dt><dd>{i.routingMode === 'ALLOWLIST' ? `${i.cedenteIds.length} selecionado(s)` : 'Todos os ativos do fundo'}</dd></div><div><dt className="text-muted-foreground">Última sincronização</dt><dd>{emailDateLabel(i.health?.lastDeltaSuccess ?? null)}</dd></div><div><dt className="text-muted-foreground">Validade das notificações</dt><dd>{emailDateLabel(i.health?.subscriptionExpiresAt ?? null)}</dd></div></dl>
          {(i.testErrorCode || i.health?.lastErrorCode) && <p className="rounded-lg bg-destructive/5 p-3 text-sm">{emailErrorMessage(i.testErrorCode ?? i.health?.lastErrorCode ?? null)}</p>}</div>
          <div className="flex flex-wrap gap-2 border-t bg-muted/20 px-5 py-4 sm:px-6"><Link className={linkClass} href={`${root}&integration=${i.id}`}>Abrir e gerenciar<ArrowRight aria-hidden="true" /></Link>{!i.enabled && <Link className={buttonVariants({ variant: 'ghost', className: 'min-h-10' })} href={`${root}&integration=${i.id}&edit=1`}><Settings2 aria-hidden="true" />Editar</Link>}{i.enabled && <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="size-4" aria-hidden="true" />Leitura ativada</span>}</div>
        </article>)}</div>
      </>}
  </div>
}
