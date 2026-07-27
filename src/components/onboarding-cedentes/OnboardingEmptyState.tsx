'use client'

import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  onClear: () => void
}

export function OnboardingEmptyState({ onClear }: Props) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed bg-card p-8 text-center">
      <span className="mb-3 flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <SearchX className="size-5" aria-hidden="true" />
      </span>
      <h2 className="text-lg font-semibold">Nenhum cedente encontrado</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Ajuste os filtros ou limpe a busca para voltar a visualizar a fila de onboarding.
      </p>
      <Button type="button" variant="outline" className="mt-4" onClick={onClear}>
        Limpar filtros
      </Button>
    </div>
  )
}
