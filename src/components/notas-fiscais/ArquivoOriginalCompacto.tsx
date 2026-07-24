'use client'

import { useState } from 'react'
import { ExternalLink, Eye, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

function fileNameFromPath(path: string | null | undefined) {
  if (!path) return 'Arquivo original'
  return path.split('/').filter(Boolean).pop() || path
}

function fileKind(path: string | null | undefined) {
  if (!path) return 'Arquivo'
  if (/\.pdf$/i.test(path)) return 'PDF'
  if (/\.(jpg|jpeg|png)$/i.test(path)) return 'Imagem'
  if (/\.xml$/i.test(path)) return 'XML'
  return 'Arquivo'
}

export function ArquivoOriginalCompacto({
  previewUrl,
  arquivoUrl,
  title = 'Arquivo original',
}: {
  previewUrl: string | null
  arquivoUrl: string | null | undefined
  title?: string
}) {
  const [open, setOpen] = useState(false)
  if (!previewUrl) return null

  const name = fileNameFromPath(arquivoUrl)
  const kind = fileKind(arquivoUrl)
  const isPdf = /\.pdf$/i.test(arquivoUrl || '')
  const isImage = /\.(jpg|jpeg|png)$/i.test(arquivoUrl || '')

  return (
    <>
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileText size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-foreground">{title}</h3>
            <p className="truncate text-sm text-muted-foreground">{name}</p>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{kind}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Eye size={14} />
            Visualizar
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}>
            <ExternalLink size={14} />
            Abrir em nova aba
          </Button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{title}</p>
                <p className="truncate text-sm text-muted-foreground">{name}</p>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Fechar preview">
                <X size={18} />
              </Button>
            </div>
            <div className="overflow-auto p-4">
              {isPdf ? (
                <iframe src={previewUrl} className="h-[72vh] w-full rounded-lg border" title={title} />
              ) : isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt={title} className="mx-auto max-h-[72vh] rounded-lg border object-contain" />
              ) : (
                <div className="rounded-lg border bg-muted p-6 text-center">
                  <FileText size={36} className="mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Preview indisponível para este tipo. Use “Abrir em nova aba”.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
