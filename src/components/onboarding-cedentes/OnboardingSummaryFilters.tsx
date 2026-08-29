'use client'

import { CheckCircle2, Clock, ListFilter, PauseCircle, ShieldAlert, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EtapaOnboarding } from './types'

type Props = {
  etapa: EtapaOnboarding
  counts: Record<EtapaOnboarding, number>
  onChange: (etapa: EtapaOnboarding) => void
}

const icons = {
  pendencias: ListFilter,
  sem_fundo: ShieldAlert,
  sem_politica: Clock,
  aptos: CheckCircle2,
  suspensos: PauseCircle,
  todos: Users,
} satisfies Record<EtapaOnboarding, typeof ListFilter>

const labels = {
  pendencias: 'Pendencias',
  sem_fundo: 'Sem fundo',
  sem_politica: 'Sem politica',
  aptos: 'Aptos',
  suspensos: 'Suspensos',
  todos: 'Todos',
} satisfies Record<EtapaOnboarding, string>

export function OnboardingSummaryFilters({ etapa, counts, onChange }: Props) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
      {(Object.keys(labels) as EtapaOnboarding[]).map((key) => {
        const Icon = icons[key]
        const selected = etapa === key
        return (
          <Button
            key={key}
            type="button"
            variant={selected ? 'default' : 'outline'}
            className={cn('h-auto justify-between gap-3 px-3 py-3 text-left', selected && 'shadow-sm')}
            onClick={() => onChange(key)}
            aria-pressed={selected}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{labels[key]}</span>
            </span>
            <Badge variant={selected ? 'secondary' : 'outline'} className="shrink-0">
              {counts[key]}
            </Badge>
          </Button>
        )
      })}
    </div>
  )
}
