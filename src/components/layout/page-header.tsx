import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
  className,
  titleClassName,
  align = 'end',
}: {
  title: string
  description?: string
  action?: ReactNode
  eyebrow?: string
  className?: string
  titleClassName?: string
  align?: 'start' | 'center' | 'end'
}) {
  const alignmentClass = align === 'center' ? 'sm:items-center' : align === 'start' ? 'sm:items-start' : 'sm:items-end'

  return (
    <div className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:justify-between', alignmentClass, className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>}
        <h1 className={cn('break-words text-2xl font-semibold tracking-tight text-foreground sm:text-3xl', titleClassName)}>{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}
