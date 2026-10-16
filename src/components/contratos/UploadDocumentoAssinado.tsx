'use client'

import { useRef, useState } from 'react'
import { Upload, Download, Loader2, Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { buckets } from '@/lib/storage'
import type { ContratoDocumentType, ContratoEntityType } from '@/lib/types/domain'
import { useNotifications } from '@/components/notifications/notification-provider'
import { AcoesArquivoDocumento, DocumentoArquivoLinha } from '@/components/documentos/DocumentoArquivoLinha'
import { abrirDocumentoAutorizado, type AcaoArquivoDocumento } from '@/lib/documentos/abrir-documento-client'
import { AreaSoltarDocumento } from '@/components/documentos/AreaSoltarDocumento'

interface Props {
  label: string
  storagePath: string | null
  uploadPath: string  // caminho destino no bucket (ex: 'cedentes/{id}/contrato-assinado.pdf')
  tipoEntidade: ContratoEntityType
  entidadeId: string
  tipoDocumento: ContratoDocumentType
  accept?: string     // default: 'application/pdf'
  onSuccess: (path: string) => void
  apresentacao?: 'botao' | 'linha'
}

export function UploadDocumentoAssinado({ label, storagePath, uploadPath, tipoEntidade, entidadeId, tipoDocumento, accept = 'application/pdf', onSuccess, apresentacao = 'botao' }: Props) {
  const notifications = useNotifications()
  const inputRef = useRef<HTMLInputElement>(null)
  const envioEmCurso = useRef(false)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [currentPath, setCurrentPath] = useState(storagePath)

  const handleDownload = async (acao: AcaoArquivoDocumento = 'visualizar') => {
    if (!currentPath) return
    setDownloading(true)
    try {
      const params = new URLSearchParams({
        tipo_entidade: tipoEntidade,
        entidade_id: entidadeId,
        tipo_documento: tipoDocumento,
      })
      const res = await fetch(`/api/contratos/download?${params.toString()}`)
      const data = await res.json()
      if (data.url) abrirDocumentoAutorizado(data.url, acao, `${label}.pdf`)
      else notifications.error('Erro ao obter link de download.')
    } catch {
      notifications.error('Erro ao baixar arquivo.')
    } finally {
      setDownloading(false)
    }
  }

  const enviarArquivo = async (file: File) => {
    if (envioEmCurso.current) return
    envioEmCurso.current = true
    setUploading(true)

    try {
      const supabase = createClient()
      const { error: uploadError } = await supabase.storage
        .from(buckets.contratos)
        .upload(uploadPath, file, { contentType: file.type, upsert: true })

      if (uploadError) throw new Error(uploadError.message)

      setCurrentPath(uploadPath)
      onSuccess(uploadPath)
      notifications.success('Documento assinado enviado.')
    } catch (err) {
      notifications.error(err instanceof Error ? err.message : 'Erro ao enviar arquivo.')
    } finally {
      envioEmCurso.current = false
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || uploading) return
    await enviarArquivo(file)
  }

  const receberArquivoSolto = async (file: File) => {
    if (uploading || downloading || envioEmCurso.current) return
    if (currentPath && !window.confirm(`Substituir ${label}?`)) return
    await enviarArquivo(file)
  }

  return (
    <AreaSoltarDocumento className="space-y-1" habilitado={apresentacao === 'linha'} bloqueado={uploading || downloading} aceitar={accept} onArquivo={receberArquivoSolto} onErro={mensagem => notifications.error(mensagem)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFileChange}
      />

      {apresentacao === 'linha' ? (
        <DocumentoArquivoLinha titulo={label} detalhe={currentPath ? 'PDF · Recebido' : 'Pendente de envio'} acoes={currentPath ? <AcoesArquivoDocumento titulo={label} ocupado={downloading || uploading} baixando={downloading} onVisualizar={() => handleDownload()} onBaixar={() => handleDownload('baixar')}>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => inputRef.current?.click()} disabled={uploading || downloading} aria-label={`Substituir ${label}`} title={`Substituir ${label}`}>{uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}</Button>
        </AcoesArquivoDocumento> : <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading} aria-label={`Anexar ${label}`}>{uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}{uploading ? 'Enviando…' : 'Anexar'}</Button>} />
      ) : currentPath ? (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDownload()}
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
    </AreaSoltarDocumento>
  )
}
