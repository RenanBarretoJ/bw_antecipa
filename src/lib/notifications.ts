export type NotificationType = 'success' | 'error' | 'warning' | 'info'

export type ActionNotificationResult = {
  success?: boolean
  message?: string | null
  notification?: {
    type?: NotificationType
    title?: string
    message?: string
    details?: string
  }
}

export type NotificationInput = {
  type: NotificationType
  title?: string
  message: string
  details?: string
  dedupeKey?: string
  durationMs?: number | null
}

export const notificationDurations: Record<NotificationType, number | null> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: 10000,
}

export function getNotificationDuration(type: NotificationType, durationMs?: number | null) {
  if (durationMs !== undefined) return durationMs
  return notificationDurations[type]
}

export function notificationFromActionResult(
  result: ActionNotificationResult | null | undefined,
  fallbackMessage = 'A operação foi concluída.',
): NotificationInput | null {
  if (!result) return null

  const explicit = result.notification
  const message = explicit?.message || result.message || fallbackMessage
  if (!message) return null

  return {
    type: explicit?.type || (result.success ? 'success' : 'error'),
    title: explicit?.title,
    message,
    details: explicit?.details,
    dedupeKey: `${explicit?.type || (result.success ? 'success' : 'error')}:${message}`,
  }
}

export function shouldMergeNotifications(current: { message: string; type: NotificationType }, next: NotificationInput) {
  return current.type === next.type && current.message === next.message
}
