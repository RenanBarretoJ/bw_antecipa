'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

const IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])

function normalizedMimeType(mimeType: string | null | undefined) {
  return mimeType?.split(';', 1)[0].trim().toLowerCase() || ''
}

export function resolvePreviewType({
  path,
  mimeType,
}: {
  path: string | null | undefined
  mimeType?: string | null
}): 'pdf' | 'image' | 'unsupported' {
  const normalizedMime = normalizedMimeType(mimeType)
  if (normalizedMime === 'application/pdf') return 'pdf'
  if (IMAGE_MIME_TYPES.has(normalizedMime)) return 'image'
  if (/\.pdf(?:$|\?)/i.test(path || '')) return 'pdf'
  if (/\.(jpg|jpeg|png|gif|webp)(?:$|\?)/i.test(path || '')) return 'image'
  return 'unsupported'
}

export function isPreviewPdf(path: string | null | undefined, mimeType?: string | null) {
  return resolvePreviewType({ path, mimeType }) === 'pdf'
}

export function isPreviewImage(path: string | null | undefined, mimeType?: string | null) {
  return resolvePreviewType({ path, mimeType }) === 'image'
}

export function FilePreviewContent({
  url,
  filePath,
  mimeType,
  title,
  className = 'h-[72vh]',
}: {
  url: string
  filePath?: string | null
  mimeType?: string | null
  title: string
  className?: string
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [imageStatus, setImageStatus] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const [imageAttempt, setImageAttempt] = useState(0)
  const previewType = resolvePreviewType({ path: filePath || url, mimeType })
  const isPdf = previewType === 'pdf'
  const isImage = previewType === 'image'

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

  useEffect(() => {
    if (!isImage) return
    setImageStatus('loading')
    setImageAttempt(0)
  }, [isImage, url])

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
    return (
      <div className={`relative flex min-h-48 w-full items-center justify-center overflow-auto rounded-lg border bg-muted/30 p-3 ${className}`}>
        {imageStatus !== 'failed' && (
          // Signed URLs privadas e temporarias nao devem passar pelo optimizer do Next.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${url}:${imageAttempt}`}
            src={url}
            alt={title}
            className={`mx-auto h-auto max-h-[68vh] max-w-full rounded object-contain transition-opacity ${imageStatus === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setImageStatus('loaded')}
            onError={() => setImageStatus('failed')}
            decoding="async"
          />
        )}

        {imageStatus === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center" aria-live="polite">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Carregando documento...
            </div>
          </div>
        )}

        {imageStatus === 'failed' && (
          <div className="max-w-md space-y-3 p-6 text-center" role="alert">
            <FileText size={40} className="mx-auto text-muted-foreground" />
            <div>
              <p className="font-semibold text-foreground">Não foi possível carregar a imagem deste documento.</p>
              <p className="mt-1 text-sm text-muted-foreground">A URL temporária pode ter expirado ou o arquivo pode estar indisponível.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" variant="outline" onClick={() => {
                setImageStatus('loading')
                setImageAttempt((attempt) => attempt + 1)
              }}>
                Tentar novamente
              </Button>
              <Button type="button" variant="outline" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
                <ExternalLink size={14} />
                Abrir documento
              </Button>
            </div>
          </div>
        )}
      </div>
    )
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
