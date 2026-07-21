import type { ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Clock3, FileText, Loader2, Search, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

export function DetailSection({ title, icon: Icon, action, children, className }: { title: string; icon?: typeof FileText; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={cn('overflow-hidden rounded-xl border border-border bg-card shadow-sm', className)}><div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4"><div className="flex min-w-0 items-center gap-2.5">{Icon && <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><Icon size={17} aria-hidden="true" /></span>}<h2 className="truncate text-base font-semibold">{title}</h2></div>{action}</div><div className="p-5">{children}</div></section>
}

export function DetailField({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return <div className={cn('flex min-w-0 flex-col gap-1', className)}><dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt><dd className="break-words text-sm font-medium text-foreground">{value || '—'}</dd></div>
}

export function FieldGrid({ children, className }: { children: ReactNode; className?: string }) { return <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3', className)}>{children}</dl> }

const statusConfig: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  aprovado: { label: 'Aprovado', icon: CheckCircle2, className: 'bg-success/20 text-success-foreground ring-success/40' },
  aprovada: { label: 'Aprovada', icon: CheckCircle2, className: 'bg-success/20 text-success-foreground ring-success/40' },
  ativo: { label: 'Ativo', icon: CheckCircle2, className: 'bg-success text-success-foreground ring-success/35' },
  pendente: { label: 'Pendente', icon: Clock3, className: 'bg-warning/20 text-warning-foreground ring-warning/40' },
  em_analise: { label: 'Em análise', icon: Clock3, className: 'bg-warning/20 text-warning-foreground ring-warning/40' },
  enviado: { label: 'Enviado', icon: FileText, className: 'bg-info/20 text-info-foreground ring-info/40' },
  reprovado: { label: 'Reprovado', icon: XCircle, className: 'bg-destructive/15 text-destructive ring-destructive/35' },
  rejeitado: { label: 'Rejeitado', icon: XCircle, className: 'bg-destructive/15 text-destructive ring-destructive/35' },
  bloqueado: { label: 'Bloqueado', icon: AlertCircle, className: 'bg-destructive/15 text-destructive ring-destructive/35' },
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const config = statusConfig[status] || { label: label || status.replaceAll('_', ' '), icon: AlertCircle, className: 'bg-muted text-muted-foreground ring-border' }
  const Icon = config.icon
  return <span className={cn('inline-flex h-6 w-fit items-center gap-1.5 rounded-full px-2.5 text-xs font-medium capitalize ring-1 ring-inset', config.className)}><Icon size={13} aria-hidden="true" />{label || config.label}</span>
}

export function MetricCard({ label, value, description, icon: Icon, tone = 'primary' }: { label: string; value: ReactNode; description?: string; icon?: typeof FileText; tone?: 'primary' | 'success' | 'warning' | 'info' }) {
  return <div className="rounded-xl border border-border bg-card p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>{description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}</div>{Icon && <span className={cn('flex size-9 items-center justify-center rounded-lg', tone === 'success' ? 'bg-success/20 text-success-foreground' : tone === 'warning' ? 'bg-warning/20 text-warning-foreground' : tone === 'info' ? 'bg-info/20 text-info-foreground' : 'bg-primary/15 text-primary')}><Icon size={18} aria-hidden="true" /></span>}</div></div>
}

export function FilterBar({ search, onSearch, placeholder = 'Buscar...', children }: { search?: string; onSearch?: (value: string) => void; placeholder?: string; children?: ReactNode }) {
  return <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm md:flex-row md:items-center">{onSearch && <div className="relative min-w-0 flex-1"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input value={search || ''} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} className="pl-9" aria-label={placeholder} /></div>}{children && <div className="flex flex-wrap items-center gap-2">{children}</div>}</div>
}

export function DataTableContainer({ children, className }: { children: ReactNode; className?: string }) { return <div className={cn('overflow-hidden rounded-xl border border-border bg-card shadow-sm', className)}><div className="w-full overflow-x-auto">{children}</div></div> }
export function EmptyState({ title, description, action, icon: Icon = FileText }: { title: string; description?: string; action?: ReactNode; icon?: typeof FileText }) { return <div className="flex flex-col items-center justify-center px-6 py-14 text-center"><span className="mb-3 flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Icon size={22} aria-hidden="true" /></span><h3 className="font-semibold">{title}</h3>{description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}{action && <div className="mt-4">{action}</div>}</div> }
export function LoadingState({ label = 'Carregando...' }: { label?: string }) { return <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted-foreground"><Loader2 size={24} className="animate-spin text-primary" aria-hidden="true" /><span>{label}</span></div> }
export function ErrorState({ message, action }: { message: string; action?: ReactNode }) { return <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-5 text-sm text-destructive"><div className="flex items-start gap-3"><AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><div><p className="font-medium">Não foi possível carregar esta seção.</p><p className="mt-1">{message}</p>{action && <div className="mt-3">{action}</div>}</div></div></div> }
export function DocumentRow({ name, file, version, status, actions }: { name: string; file?: string | null; version?: string | number | null; status: string; actions?: ReactNode }) { return <div className="flex flex-col gap-3 rounded-lg border border-border bg-background px-4 py-3 transition-colors hover:bg-accent/40 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><FileText size={17} aria-hidden="true" /></span><div className="min-w-0"><p className="truncate text-sm font-medium">{name}</p><p className="truncate text-xs text-muted-foreground">{file || 'Nenhum arquivo enviado'}{version ? ` · ${version}` : ''}</p></div></div><div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end"><StatusBadge status={status} />{actions}</div></div> }
export function ResponsiveActions({ children, className }: { children: ReactNode; className?: string }) { return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div> }
