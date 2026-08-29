'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/components/notifications/notification-provider'

export function BotaoDownloadArquivoOperacao({
  operacaoId,
  tipoDocumento,
  label,
}: {
  operacaoId: string
  tipoDocumento: string
  label: string
}) {
  const notifications = useNotifications()
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const params = new URLSearchParams({
        tipo_entidade: 'operacao',
        entidade_id: operacaoId,
        tipo_documento: tipoDocumento,
      })
      const response = await fetch(`/api/contratos/download?${params.toString()}`)
      const data = await response.json()
      if (data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer')
      } else {
        notifications.error(data.error || 'Não foi possível abrir o documento.')
      }
    } catch {
      notifications.error('Não foi possível abrir o documento.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" className="gap-2" onClick={handleDownload} disabled={downloading}>
      {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      {label}
    </Button>
  )
}
