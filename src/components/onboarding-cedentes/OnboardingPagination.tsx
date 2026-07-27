'use client'

import { Button } from '@/components/ui/button'

type Props = {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

export function OnboardingPagination({ page, pageSize, total, onPageChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)

  return (
    <div className="flex flex-col gap-2 border-t p-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>
        Exibindo {start}-{end} de {total} cedente(s)
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Anterior
        </Button>
        <span className="min-w-20 text-center">
          {page} / {totalPages}
        </span>
        <Button type="button" variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Proxima
        </Button>
      </div>
    </div>
  )
}
