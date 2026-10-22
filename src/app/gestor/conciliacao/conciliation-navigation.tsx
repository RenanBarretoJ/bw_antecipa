import Link from 'next/link'
import type { ConciliacaoFilters, ConciliacaoTab } from '@/lib/financeiro/conciliacao/loaders.server'
import { hrefConciliacao, parametrosConciliacao, secaoConciliacao, SECOES_CONCILIACAO } from '@/lib/navigation/conciliacao'
import { cn } from '@/lib/utils'
import { CONCILIACAO_SUBTABS } from './central-ux'

type NavigationFilters = Pick<ConciliacaoFilters, 'tab' | 'dataReferencia' | 'fila'>

export function ConciliationNavigation({ filters }: { filters: NavigationFilters }) {
  const active = secaoConciliacao(filters.tab)
  const linkClass = 'flex min-h-11 items-center justify-center rounded-lg px-3 py-2 text-center text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return <div className="space-y-3">
    <nav aria-label="Seções da conciliação" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 lg:grid-cols-5">
      {SECOES_CONCILIACAO.map(section => {
        const selected = active.id === section.id
        const target: ConciliacaoTab = selected ? filters.tab : section.views[0]
        return <Link key={section.id} href={hrefConciliacao(target, filters.dataReferencia)} prefetch={false} scroll={false}
          aria-current={selected ? 'page' : undefined}
          className={cn(linkClass, selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/50 hover:text-foreground')}>
          {section.label}
        </Link>
      })}
    </nav>
    {active.views.length > 1 && <nav aria-label={`Visões de ${active.label}`} className="flex flex-wrap gap-2">
      {active.views.map(view => <Link key={view} href={hrefConciliacao(view, filters.dataReferencia)} prefetch={false} scroll={false}
        aria-current={filters.tab === view ? 'page' : undefined}
        className={cn(linkClass, 'border', filters.tab === view ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
        {CONCILIACAO_SUBTABS.find(item => item.id === view)?.label}
      </Link>)}
    </nav>}
  </div>
}

export function HiddenConciliationNavigation({ filters }: { filters: NavigationFilters }) {
  const params = parametrosConciliacao(filters.tab, undefined, filters.fila)
  return <>{[...params.entries()].map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}</>
}
