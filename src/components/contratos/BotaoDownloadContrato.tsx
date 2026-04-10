'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FileText, Download, RefreshCw, Loader2 } from 'lucide-react'

interface Props {
  tipo: 'contrato' | 'termo'
  id: string // cedente_id ou operacao_id
  storagePath?: string | null // caminho no storage (se ja gerado)
  label?: string
  className?: string
}

export function BotaoDownloadContrato({ tipo, id, storagePath, label, className }: Props) {
  const [gerando, setGerando] = useState(false)
  const [currentPath, setCurrentPath] = useState(storagePath)
  const [downloading, setDownloading] = useState(false)

  const handleGerar = async () => {
    setGerando(true)
    try {
      const endpoint = tipo === 'contrato'
        ? '/api/contratos/gerar-contrato'
        : '/api/contratos/gerar-termo'

      const body = tipo === 'contrato'
        ? { cedente_id: id }
        : { operacao_id: id }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (data.sucesso && data.path) {
        setCurrentPath(data.path)
        // Abrir download imediato
        if (data.url) {
          window.open(data.url, '_blank')
        }
      } else {
        alert(data.error || 'Erro ao gerar documento.')
      }
    } catch {
      alert('Erro ao gerar documento. Tente novamente.')
    } finally {
      setGerando(false)
    }
  }

  const handleDownload = async () => {
    if (!currentPath) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/contratos/download?path=${encodeURIComponent(currentPath)}`)
      const data = await res.json()
      if (data.url) {
        window.open(data.url, '_blank')
      } else {
        alert('Erro ao obter link de download.')
      }
    } catch {
      alert('Erro ao baixar documento.')
    } finally {
      setDownloading(false)
    }
  }

  const defaultLabel = tipo === 'contrato' ? 'Contrato de Cessao' : 'Termo de Cessao'

  if (currentPath) {
    return (
      <div className={`flex items-center gap-2${className ? ' ' + className : ''}`}>
        <Button
          onClick={handleDownload}
          disabled={downloading}
          variant="outline"
          size="sm"
          className="gap-2 flex-1"
        >
          {downloading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}
          {label || defaultLabel}
        </Button>
        <Button
          onClick={handleGerar}
          disabled={gerando}
          variant="ghost"
          size="icon-sm"
          title="Regenerar PDF"
        >
          {gerando ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
        </Button>
      </div>
    )
  }

  return (
    <Button
      onClick={handleGerar}
      disabled={gerando}
      size="sm"
      className={`gap-2${className ? ' ' + className : ''}`}
    >
      {gerando ? (
        <>
          <Loader2 size={14} className="animate-spin" />
          Gerando PDF...
        </>
      ) : (
        <>
          <FileText size={14} />
          Gerar {label || defaultLabel}
        </>
      )}
    </Button>
  )
}
