'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, Paperclip, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/components/notifications/notification-provider'
import type { TipoDocumentoAssinadoOperacao } from '@/lib/operacoes/documentos-assinados'
import { AcoesArquivoDocumento, DocumentoArquivoLinha } from '@/components/documentos/DocumentoArquivoLinha'
import { abrirDocumentoAutorizado, type AcaoArquivoDocumento } from '@/lib/documentos/abrir-documento-client'

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
  apresentacao?: 'botao' | 'linha'
  destaquePendente?: boolean
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
  apresentacao = 'botao',
  destaquePendente = false,
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

  const handleDownload = async (acao: AcaoArquivoDocumento = 'visualizar') => {
    if (!disponivel || baixando) return
    setBaixando(true)
    try {
      const params = new URLSearchParams({ tipoDocumento })
      const response = await fetch(`/api/operacoes/${encodeURIComponent(operacaoId)}/documentos-assinados?${params}`)
      const data = await lerResposta(response)
      if (!response.ok || !data.url) throw new Error(data.message || 'Nao foi possivel obter o documento.')
      abrirDocumentoAutorizado(data.url, acao, `${label}.pdf`)
    } catch (error) {
      notifications.error(error instanceof Error ? error.message : 'Nao foi possivel abrir o documento.')
    } finally {
      setBaixando(false)
    }
  }

  return (
    <div className="w-full min-w-0">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        disabled={enviando}
        onChange={handleFileChange}
      />

      {apresentacao === 'linha' ? (
        <DocumentoArquivoLinha titulo={label} detalhe={disponivel ? 'PDF · Recebido' : 'Pendente de envio'} destaquePendente={destaquePendente && !disponivel} acoes={disponivel ? <AcoesArquivoDocumento titulo={label} ocupado={baixando || enviando} baixando={baixando} onVisualizar={() => handleDownload()} onBaixar={() => handleDownload('baixar')}>
          <Button type="button" variant="ghost" size="icon-sm" onClick={abrirSeletor} disabled={enviando || baixando} title="Substituir documento" aria-label={`Substituir ${label}`}>{enviando ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}</Button>
        </AcoesArquivoDocumento> : <Button type="button" variant="outline" size="sm" onClick={abrirSeletor} disabled={enviando} aria-label={`Anexar ${label}`}>{enviando ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}{enviando ? 'Enviando…' : 'Anexar'}</Button>} />
      ) : disponivel ? (
        <div className="flex w-full min-w-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDownload()}
            disabled={baixando || enviando}
            className="min-w-0 flex-1 gap-2 text-xs"
          >
            {baixando ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            <span className="min-w-0 truncate">{label}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={abrirSeletor}
            disabled={enviando || baixando}
            title="Substituir documento"
            aria-label="Substituir documento"
            className="shrink-0 text-muted-foreground"
          >
            {enviando ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={abrirSeletor}
          disabled={enviando}
          className="w-full min-w-0 gap-2 border-dashed text-xs"
        >
          {enviando ? (
            <><Loader2 size={13} className="animate-spin" /> Enviando...</>
          ) : (
            <><Paperclip size={13} /><span className="min-w-0 truncate">Anexar {label}</span></>
          )}
        </Button>
      )}
    </div>
  )
}
