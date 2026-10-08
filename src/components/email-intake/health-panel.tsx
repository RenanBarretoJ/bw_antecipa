import { carregarSaudeEmail } from '@/app/actions/email-automation'
import { assessEmailHealth, type AlertCode } from '@/lib/email-intake/automation/health'
import { EmailSyncButton } from './sync-button'

const statusLabels = { HEALTHY: 'Operando normalmente', DEGRADED: 'Requer atenção', ERROR: 'Falha operacional', DISABLED: 'Desativada' }
const alertLabels: Record<AlertCode, string> = {
  STALE_SYNC: 'Sem sincronização concluída há mais de 15 minutos.', BACKLOG: 'Há anexos aguardando há mais de 15 minutos.',
  SUBSCRIPTION_CRITICAL: 'A assinatura de notificações precisa de atenção.', GRAPH_AUTH: 'O Outlook recusou o acesso da integração.',
  THROTTLING: 'O Outlook está limitando as consultas. Novas tentativas respeitarão o prazo informado.',
  WORKER_STUCK: 'Um processamento não terminou no prazo esperado.', RECONCILIATION_GAP: 'A última reconciliação recuperou mensagens que ainda não estavam registradas.',
  REPEATED_RETRY: 'Há falhas repetidas ou anexos que precisam de verificação.',
}
const date = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(value)) : 'Ainda não registrado'

export async function EmailHealthPanel({ fundoId }: { fundoId: string }) {
  const rows = await carregarSaudeEmail(fundoId)
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nenhuma integração de e-mail configurada para este fundo.</p>
  return <div className="space-y-4">{rows.map(row => {
    const health = assessEmailHealth(row)
    return <section className="space-y-4 rounded-lg border bg-card p-5" key={row.integrationId}>
      <div><h2 className="font-semibold">{row.name}</h2><p className="text-sm text-muted-foreground">Outlook · {row.mailbox}</p>
        <p className="mt-2 font-medium">{statusLabels[health.status]}</p></div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><dt>Última sincronização</dt><dd>{date(row.lastDeltaSuccess)}</dd></div>
        <div><dt>Validade das notificações</dt><dd>{date(row.subscriptionExpiresAt)}</dd></div>
        <div><dt>Última reconciliação</dt><dd>{date(row.lastReconciliationAt)}</dd></div>
        <div><dt>Aguardando / processando</dt><dd>{row.pendingCount} / {row.processingCount}</dd></div>
        <div><dt>Nova tentativa / falha</dt><dd>{row.retryableCount} / {row.failedCount}</dd></div>
        <div><dt>Aguardando revisão</dt><dd>{row.requiresReviewCount}</dd></div>
        <div><dt>Pendência mais antiga</dt><dd>{date(row.oldestPendingAt)}</dd></div>
      </dl>
      {health.alerts.length > 0 && <ul className="space-y-1 text-sm" aria-label="Alertas da integração">{health.alerts.map(code => <li key={code}>{alertLabels[code]}</li>)}</ul>}
      <EmailSyncButton integrationId={row.integrationId} disabled={!row.enabled || row.blockedModes.length > 0} />
    </section>
  })}</div>
}
