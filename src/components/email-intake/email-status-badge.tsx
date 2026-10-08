import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import type { OperatorTone } from '@/lib/email-intake/operations/presentation'

const tones: Record<OperatorTone, string> = {
  neutral: 'border-border bg-muted/50 text-muted-foreground',
  success: 'border-emerald-600/30 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  attention: 'border-amber-600/30 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
}

export function EmailStatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: OperatorTone }) {
  return <Badge variant="outline" className={`h-auto min-h-6 whitespace-normal px-2.5 py-1 ${tones[tone]}`}>
    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />{children}
  </Badge>
}
