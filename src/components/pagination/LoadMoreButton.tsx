'use client'

import { AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type LoadMoreButtonProps = {
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void
  error?: string | null
  disabled?: boolean
  className?: string
}

export function LoadMoreButton({
  hasMore,
  loading,
  onLoadMore,
  error,
  disabled = false,
  className,
}: LoadMoreButtonProps) {
  if (!hasMore && !error) return null

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      {error ? (
        <p
          role="alert"
          className="flex items-center gap-1.5 text-sm text-destructive"
        >
          <AlertCircle className="size-4" aria-hidden="true" />
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        variant={error ? 'outline' : 'default'}
        disabled={disabled || loading || !hasMore}
        aria-busy={loading}
        onClick={onLoadMore}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {error ? 'Tentar novamente' : loading ? 'Carregando...' : 'Carregar mais'}
      </Button>
    </div>
  )
}
