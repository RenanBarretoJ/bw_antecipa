'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, Paperclip, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/components/notifications/notification-provider'
import type { TipoDocumentoAssinadoOperacao } from '@/lib/operacoes/documentos-assinados'

type ApiResponse = {
  success?: boolean
  message?: string
  url?: string
}

type Props = {
  label: string
  operacaoId: string
  tipoDocumento: TipoDocumentoAssinadoOperacao
  storagePath: string | null
  onSuccess?: () => void
}

async function lerResposta(response: Response): Promise<ApiResponse> {
  return response.json().catch(() => ({ success: false, message: 'Resposta invalida do servidor.' }))
}

export function UploadDocumentoAssinadoOperacao({
  label,
  operacaoId,
  tipoDocumento,
  storagePath,
  onSuccess,
}: Props) {
  const notifications = useNotifications()
  const inputRef = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [baixando, setBaixando] = useState(false)
  const [disponivel, setDisponivel] = useState(Boolean(storagePath))

  useEffect(() => setDisponivel(Boolean(storagePath)), [storagePath])

  const abrirSeletor = () => {
    if (enviando) return
    if (disponivel && !window.confirm(`Substituir ${label}? O documento atual sera preservado se o novo envio falhar.`)) {
      return
    }
    inputRef.current?.click()
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const arquivo = event.target.files?.[0]
    if (!arquivo || enviando) return

    setEnviando(true)
    try {
      const formData = new FormData()
      formData.set('tipoDocumento', tipoDocumento)
      formData.set('arquivo', arquivo)

      const response = await fetch(`/api/operacoes/${encodeURIComponent(operacaoId)}/documentos-assinados`, {
        method: 'POST',
        body: formData,
      })
      const data = await lerResposta(response)
      if (!response.ok || !data.success) throw new Error(data.message || 'Nao foi possivel enviar o documento.')

      setDisponivel(true)
      onSuccess?.()
      notifications.success(data.message || 'Documento enviado com sucesso.')
    } catch (error) {
      notifications.error(error instanceof Error ? error.message : 'Nao foi possivel enviar o documento.')
    } finally {
      setEnviando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleDownload = async () => {
    if (!disponivel || baixando) return
    setBaixando(true)
    try {
      const params = new URLSearchParams({ tipoDocumento })
      const response = await fetch(`/api/operacoes/${encodeURIComponent(operacaoId)}/documentos-assinados?${params}`)
      const data = await lerResposta(response)
      if (!response.ok || !data.url) throw new Error(data.message || 'Nao foi possivel obter o documento.')
      window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      notifications.error(error instanceof Error ? error.message : 'Nao foi possivel abrir o documento.')
    } finally {
      setBaixando(false)
    }
  }

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        disabled={enviando}
        onChange={handleFileChange}
      />

      {disponivel ? (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={baixando || enviando}
            className="gap-2 flex-1 text-xs"
          >
            {baixando ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {label}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={abrirSeletor}
            disabled={enviando || baixando}
            title="Substituir arquivo"
            className="text-xs gap-1 text-muted-foreground"
          >
            {enviando ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {enviando ? 'Substituindo...' : 'Substituir'}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={abrirSeletor}
          disabled={enviando}
          className="w-full gap-2 text-xs border-dashed"
        >
          {enviando ? (
            <><Loader2 size={13} className="animate-spin" /> Enviando...</>
          ) : (
            <><Paperclip size={13} /> Anexar {label}</>
          )}
        </Button>
      )}
    </div>
  )
}
