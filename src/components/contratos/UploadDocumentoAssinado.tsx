'use client'

import { useRef, useState } from 'react'
import { Upload, Download, Loader2, Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { buckets } from '@/lib/storage'

interface Props {
  label: string
  storagePath: string | null
  uploadPath: string  // caminho destino no bucket (ex: 'cedentes/{id}/contrato-assinado.pdf')
  accept?: string     // default: 'application/pdf'
  onSuccess: (path: string) => void
}

export function UploadDocumentoAssinado({ label, storagePath, uploadPath, accept = 'application/pdf', onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [currentPath, setCurrentPath] = useState(storagePath)
  const [error, setError] = useState('')

  const handleDownload = async () => {
    if (!currentPath) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/contratos/download?path=${encodeURIComponent(currentPath)}`)
      const data = await res.json()
      if (data.url) window.open(data.url, '_blank')
      else setError('Erro ao obter link de download.')
    } catch {
      setError('Erro ao baixar arquivo.')
    } finally {
      setDownloading(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setError('')
    setUploading(true)

    try {
      const supabase = createClient()
      const { error: uploadError } = await supabase.storage
        .from(buckets.contratos)
        .upload(uploadPath, file, { contentType: file.type, upsert: true })

      if (uploadError) throw new Error(uploadError.message)

      setCurrentPath(uploadPath)
      onSuccess(uploadPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar arquivo.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFileChange}
      />

      {currentPath ? (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={downloading}
            className="gap-2 flex-1 text-xs"
          >
            {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {label}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            title="Substituir arquivo"
            className="text-xs gap-1 text-muted-foreground"
          >
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {uploading ? 'Enviando...' : 'Substituir'}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full gap-2 text-xs border-dashed"
        >
          {uploading ? (
            <><Loader2 size={13} className="animate-spin" /> Enviando...</>
          ) : (
            <><Paperclip size={13} /> Anexar {label}</>
          )}
        </Button>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
