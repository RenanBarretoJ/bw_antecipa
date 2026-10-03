import Link from 'next/link'
import { z } from 'zod'
import { carregarOperacaoEmail } from '@/app/actions/email-operations'
import { emailHref, firstEmailParam, type EmailSearchParams } from '@/lib/email-intake/operations/navigation'
import { emailDateLabel, emailErrorMessage } from '@/lib/email-intake/operations/presentation'
import { EmailConfigurationWizard } from './configuration-wizard'
import { EmailCredentialEntry } from './credential-entry'
import { EmailIntegrationCommands } from './integration-commands'
import { EmailOperationalHealth, emailConfigLabels, emailHealthLabel } from './operational-health'
import { EmailMessagePanel, EmailOperationsInbox } from './operations-inbox'

const linkClass = 'inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring'

export async function EmailOperationsPage({ fundoId, basePath, params }: { fundoId: string; basePath: string; params: EmailSearchParams }) {
  const current = { ...params, fundo: fundoId }, dashboard = await carregarOperacaoEmail(fundoId)
  const tab = firstEmailParam(params.tab) || 'integrations', integration = firstEmailParam(params.integration), message = firstEmailParam(params.message)
  const row = dashboard.integrations.find(i => i.id === integration), creating = firstEmailParam(params.new) === '1', editing = firstEmailParam(params.edit) === '1'
  const root = `${basePath}?fundo=${fundoId}`
  return <div className="min-w-0 space-y-5 dark:[--primary:oklch(0.48_0.19_259)]">
    <nav className="flex flex-wrap gap-2" aria-label="Operação de e-mail">{[['integrations', 'Integrações'], ['inbox', 'Importações por e-mail'], ['review', 'Pendências de revisão']].map(([key, label]) => <Link key={key} className={`${linkClass} ${tab === key ? 'border-primary bg-primary/10' : ''}`} aria-current={tab === key ? 'page' : undefined} href={`${root}&tab=${key}`}>{label}</Link>)}</nav>
    {creating || (editing && row && !row.enabled) ? <><Link className={linkClass} href={root}>Voltar às integrações</Link><EmailConfigurationWizard key={row?.id || 'new'} fundoId={fundoId} basePath={basePath} dashboard={dashboard} initial={creating ? undefined : row} /></>
      : tab === 'inbox' || tab === 'review' ? message && z.uuid().safeParse(message).success ? <EmailMessagePanel fundoId={fundoId} basePath={basePath} params={current} messageId={message} />
        : <EmailOperationsInbox fundoId={fundoId} basePath={basePath} params={current} dashboard={dashboard} />
      : integration ? row ? <article className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><Link className={linkClass} href={root}>Voltar às integrações</Link>{!row.enabled && <Link className={linkClass} href={emailHref(basePath, current, { edit: '1' })}>Editar configuração</Link>}</div>
        <header><h2 className="text-xl font-semibold break-words">{row.name}</h2><p className="mt-1 text-sm break-all">{row.mailbox || 'Caixa ainda não definida'} · Microsoft Outlook</p><p className="mt-2 font-medium">Configuração: {emailConfigLabels[row.configStatus]}</p></header>
        <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Ambiente</dt><dd>{row.environment === 'homologacao' ? 'Homologação' : 'Produção'}</dd></div><div><dt className="text-muted-foreground">Documentos aceitos</dt><dd>{row.routingMode === 'ALLOWLIST' ? `${row.cedenteIds.length} cedente(s) selecionado(s)` : 'Todos os cedentes ativos deste fundo'}</dd></div><div><dt className="text-muted-foreground">Data inicial de leitura · Brasília</dt><dd>{emailDateLabel(row.startAt)}</dd></div><div><dt className="text-muted-foreground">Credencial</dt><dd>{dashboard.credentials.find(c => c.id === row.credentialId)?.name ?? (row.credentialId ? 'Indisponível — confira com o administrador' : 'Não vinculada ao cofre')}</dd></div><div><dt className="text-muted-foreground">Último teste de conexão</dt><dd>{emailDateLabel(row.testCompletedAt)}{row.testCompletedAt ? row.testErrorCode ? ' · Falhou' : ' · Aprovado' : ''}</dd></div></dl>
        {row.testErrorCode && <p className="text-sm" role="status">{emailErrorMessage(row.testErrorCode)}</p>}
        <p className="text-sm text-muted-foreground">E-mails anteriores à data inicial não serão importados. O CNPJ do documento determina o cedente; o remetente não define o vínculo.</p>
        {row.enabled && <p className="text-sm">Para editar a configuração, desative a integração e aguarde os processamentos em andamento.</p>}
        <EmailIntegrationCommands fundoId={fundoId} row={row} />
        <EmailOperationalHealth row={row} />
        <Link className={linkClass} href={`${root}&tab=inbox&filterIntegration=${row.id}`}>Ver mensagens desta integração</Link>
      </article> : <p role="alert">Integração não disponível neste fundo. <Link className="underline" href={root}>Voltar à lista</Link></p>
      : <>
        <div className="flex flex-wrap items-start gap-3"><Link className={`${linkClass} border-primary`} href={`${root}&new=1`}>Criar integração</Link>{dashboard.canManageCredentials && <EmailCredentialEntry fundoId={fundoId} />}</div>
        {!dashboard.integrations.length && <div className="rounded-xl border p-6"><h2 className="font-semibold">Nenhuma integração de e-mail cadastrada.</h2><p className="mt-2 text-sm text-muted-foreground">Crie uma integração para definir a caixa e os cedentes que poderão receber documentos. Você pode começar com um rascunho.</p></div>}
        <div className="grid gap-4 xl:grid-cols-2">{dashboard.integrations.map(i => <article key={i.id} className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5">
          <header><h2 className="text-lg font-semibold break-words">{i.name}</h2><p className="text-sm text-muted-foreground break-all">{i.mailbox || 'Caixa ainda não definida'} · Outlook · {i.environment === 'homologacao' ? 'Homologação' : 'Produção'}</p></header>
          <div className="flex flex-wrap gap-2 text-sm"><span className="rounded border px-2 py-1">{emailConfigLabels[i.configStatus]}</span><span className="rounded border px-2 py-1">{emailHealthLabel(i)}</span></div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Cedentes</dt><dd>{i.routingMode === 'ALLOWLIST' ? `${i.cedenteIds.length} selecionado(s)` : 'Todos os ativos do fundo'}</dd></div><div><dt className="text-muted-foreground">Última sincronização</dt><dd>{emailDateLabel(i.health?.lastDeltaSuccess ?? null)}</dd></div><div><dt className="text-muted-foreground">Validade das notificações</dt><dd>{emailDateLabel(i.health?.subscriptionExpiresAt ?? null)}</dd></div></dl>
          <p className="text-sm text-muted-foreground">{emailErrorMessage(i.testErrorCode ?? i.health?.lastErrorCode ?? null)}</p>
          <div className="flex flex-wrap gap-2"><Link className={linkClass} href={`${root}&integration=${i.id}`}>Abrir e gerenciar</Link>{!i.enabled && <Link className={linkClass} href={`${root}&integration=${i.id}&edit=1`}>Editar</Link>}</div>
        </article>)}</div>
      </>}
  </div>
}
