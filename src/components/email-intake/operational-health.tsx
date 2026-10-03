import type { EmailIntegration } from '@/lib/email-intake/operations/contracts'
import type { AlertCode } from '@/lib/email-intake/automation/health'
import { emailDateLabel, emailErrorMessage } from '@/lib/email-intake/operations/presentation'

export const emailConfigLabels = { DRAFT: 'Rascunho', ACTIVE: 'Ativa', DISABLED: 'Desativada', ERROR: 'Configuração com erro' }
export const emailHealthLabels = { HEALTHY: 'Saudável', DEGRADED: 'Requer atenção', ERROR: 'Falha operacional', DISABLED: 'Automação desativada' }
export function emailHealthLabel(row: EmailIntegration) { return row.enabled && !row.healthCheckedAt ? 'Aguardando avaliação de saúde' : emailHealthLabels[row.healthStatus] }
const alertLabels: Record<AlertCode, string> = {
  STALE_SYNC: 'Sem sincronização concluída há mais de 15 minutos.', BACKLOG: 'Há documentos aguardando há mais de 15 minutos.',
  SUBSCRIPTION_CRITICAL: 'A autorização de notificações da caixa precisa ser renovada.', GRAPH_AUTH: 'O Outlook recusou o acesso. Confira a credencial e as permissões.',
  THROTTLING: 'O Outlook limitou as consultas. O sistema respeitará o prazo para nova tentativa.', WORKER_STUCK: 'Um processamento ultrapassou o prazo esperado.',
  RECONCILIATION_GAP: 'A conferência automática localizou mensagens que faltavam.', REPEATED_RETRY: 'Há falhas repetidas. Confira os documentos e o último erro.',
}

export function EmailOperationalHealth({ row }: { row: EmailIntegration }) {
  const h = row.health
  return <section className="space-y-4" aria-label="Saúde e alertas">
    <div className="rounded-lg border p-4"><h3 className="font-semibold">{emailHealthLabel(row)}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{!h ? 'Salve e teste a configuração para preparar a leitura automática.' : row.enabled && !row.healthCheckedAt ? 'A integração foi ativada. Aguarde a avaliação automática para conferir sua saúde.' : row.healthStatus === 'HEALTHY' ? 'Tudo operando normalmente na última verificação.' : row.healthStatus === 'DISABLED' ? 'A leitura automática está desativada.' : 'Confira os alertas e o último erro para identificar a próxima ação.'}</p>
      <p className="mt-2 text-xs text-muted-foreground">Última avaliação: {emailDateLabel(row.healthCheckedAt)}</p></div>
    {h && <details className="rounded border p-4"><summary className="cursor-pointer font-medium">Ver detalhes operacionais</summary>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">{[
        ['Último acesso à caixa', emailDateLabel(h.lastConnectionSuccess)], ['Última sincronização', emailDateLabel(h.lastDeltaSuccess)],
        ['Último aviso do Outlook', emailDateLabel(h.lastWebhookSignal)], ['Última mensagem descoberta', emailDateLabel(h.lastMessageDiscovered)],
        ['Último anexo processado', emailDateLabel(h.lastAttachmentProcessed)], ['Pendência mais antiga', emailDateLabel(h.oldestPendingAt)],
        ['Aguardando / processando', `${h.pendingCount} / ${h.processingCount}`], ['Novas tentativas / falhas', `${h.retryableCount} / ${h.failedCount}`],
        ['Aguardando revisão', h.requiresReviewCount], ['Notificações da caixa', h.subscriptionStatus === 'ACTIVE' ? 'Ativas' : h.subscriptionStatus === 'ERROR' ? 'Com erro' : 'Aguardando ativação'],
        ['Validade das notificações', emailDateLabel(h.subscriptionExpiresAt)], ['Última conferência automática', emailDateLabel(h.lastReconciliationAt)],
      ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}</dl>
      <p className="mt-4 text-sm">{emailErrorMessage(h.lastErrorCode ?? h.subscriptionError)}</p>
    </details>}
    <div><h3 className="mb-2 font-semibold">Alertas</h3>
      {!row.alerts.length && <p className="text-sm text-muted-foreground">Nenhum alerta registrado. Acompanhe esta área quando a integração estiver ativa.</p>}
      {row.alerts.length > 0 && !row.alerts.some(a => a.active) && <p className="mb-2 text-sm">Nenhum alerta ativo.</p>}
      <ul className="space-y-2">{row.alerts.map(alert => <li className="rounded border p-3 text-sm" key={alert.code}>
        <p className="font-medium">{alert.active ? 'Ativo' : 'Resolvido'} · {alert.code === 'GRAPH_AUTH' || alert.code === 'WORKER_STUCK' ? 'Erro' : 'Atenção'}</p>
        <p>{alertLabels[alert.code]}</p><p className="mt-2 text-xs text-muted-foreground">Identificado: {emailDateLabel(alert.firstSeen)} · Última notificação: {emailDateLabel(alert.lastSeen)}{alert.resolvedAt ? ` · Resolvido: ${emailDateLabel(alert.resolvedAt)}` : ''}</p>
      </li>)}</ul>
    </div>
  </section>
}
