'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function isPreviewPdf(path: string | null | undefined) {
  return /\.pdf(?:$|\?)/i.test(path || '')
}

export function isPreviewImage(path: string | null | undefined) {
  return /\.(jpg|jpeg|png|gif|webp)(?:$|\?)/i.test(path || '')
}

export function FilePreviewContent({
  url,
  filePath,
  title,
  className = 'h-[72vh]',
}: {
  url: string
  filePath?: string | null
  title: string
  className?: string
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const isPdf = isPreviewPdf(filePath || url)
  const isImage = isPreviewImage(filePath || url)

  useEffect(() => {
    if (!isPdf || !url) return
    let alive = true
    let localBlobUrl: string | null = null

    async function loadPdfBlob() {
      setLoading(true)
      setFailed(false)
      setBlobUrl(null)
      try {
        const response = await fetch(url, { credentials: 'omit' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const blob = await response.blob()
        if (!alive) return
        localBlobUrl = URL.createObjectURL(blob)
        setBlobUrl(localBlobUrl)
      } catch {
        if (alive) setFailed(true)
      } finally {
        if (alive) setLoading(false)
      }
    }

    void loadPdfBlob()
    return () => {
      alive = false
      if (localBlobUrl) URL.revokeObjectURL(localBlobUrl)
    }
  }, [isPdf, url])

  if (!url) {
    return (
      <div className="rounded-lg border bg-muted p-6 text-center">
        <FileText size={36} className="mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nao foi possivel carregar o arquivo.</p>
      </div>
    )
  }

  if (isPdf) {
    if (loading) {
      return (
        <div className={`flex items-center justify-center rounded-lg border bg-muted ${className}`}>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Carregando preview seguro do PDF...
          </div>
        </div>
      )
    }

    if (blobUrl && !failed) {
      return <iframe src={blobUrl} className={`w-full rounded-lg border ${className}`} title={title} />
    }

    return (
      <div className={`flex items-center justify-center rounded-lg border bg-muted p-6 text-center ${className}`}>
        <div className="max-w-md space-y-3">
          <FileText size={40} className="mx-auto text-muted-foreground" />
          <div>
            <p className="font-semibold text-foreground">Preview protegido pelo navegador</p>
            <p className="mt-1 text-sm text-muted-foreground">Nao foi possivel carregar o PDF dentro do modal. Abra o arquivo em uma nova aba para visualizar.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
            <ExternalLink size={14} />
            Abrir em nova aba
          </Button>
        </div>
      </div>
    )
  }

  if (isImage) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={title} className="mx-auto max-h-[72vh] rounded-lg border object-contain" />
  }

  return (
    <div className="rounded-lg border bg-muted p-6 text-center">
      <FileText size={36} className="mx-auto mb-2 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Preview indisponivel para este tipo. Use Abrir em nova aba.</p>
      <Button type="button" variant="outline" className="mt-3" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
        <ExternalLink size={14} />
        Abrir em nova aba
      </Button>
    </div>
  )
}
