'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ALLOWED_PAGE_SIZES,
  normalizePageSize,
  type AllowedPageSize,
  type PaginationMeta,
} from '@/lib/pagination'
import { cn } from '@/lib/utils'

export type ListPaginationProps = {
  pagination: PaginationMeta
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: AllowedPageSize) => void
  disabled?: boolean
  className?: string
}

export function ListPagination({
  pagination,
  onPageChange,
  onPageSizeChange,
  disabled = false,
  className,
}: ListPaginationProps) {
  const pageLabel = pagination.totalPages === 0 ? 0 : pagination.page

  return (
    <nav
      aria-label="Paginação da listagem"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3',
        className,
      )}
    >
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        Itens por página
        <select
          aria-label="Itens por página"
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          value={pagination.pageSize}
          disabled={disabled}
          onChange={(event) => {
            const pageSize = normalizePageSize(event.currentTarget.value)
            onPageSizeChange(pageSize)
          }}
        >
          {ALLOWED_PAGE_SIZES.map((pageSize) => (
            <option key={pageSize} value={pageSize}>
              {pageSize}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-2">
        <span
          className="min-w-24 text-center text-sm text-muted-foreground"
          aria-live="polite"
        >
          Página {pageLabel} de {pagination.totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Página anterior"
          disabled={disabled || !pagination.hasPrevious}
          onClick={() => onPageChange(pagination.page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Próxima página"
          disabled={disabled || !pagination.hasNext}
          onClick={() => onPageChange(pagination.page + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}
