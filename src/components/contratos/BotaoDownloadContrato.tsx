'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FileText, Download, RefreshCw, Loader2, AlertTriangle } from 'lucide-react'

interface Props {
  tipo: 'contrato' | 'termo'
  id: string // cedente_id ou operacao_id
  storagePath?: string | null // caminho no storage (se ja gerado)
  hasSignedDoc?: boolean // se ja existe versao assinada no cadastro/operacao
  label?: string
  className?: string
}

export function BotaoDownloadContrato({ tipo, id, storagePath, hasSignedDoc, label, className }: Props) {
  const [gerando, setGerando] = useState(false)
  const [currentPath, setCurrentPath] = useState(storagePath)
  const [downloading, setDownloading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleGerar = async () => {
    setGerando(true)
    setShowConfirm(false)
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

  const handleClickRegerar = () => {
    // Só pede confirmação se já foi gerado antes
    if (currentPath) {
      setShowConfirm(true)
    } else {
      handleGerar()
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

  const mensagemConfirmacao = hasSignedDoc
    ? tipo === 'contrato'
      ? 'ATENÇÃO: Existe um Contrato Mãe assinado no cadastro do cedente. Ao regenerar, o documento assinado atual ficará desatualizado e precisará ser substituído. Esta ação é crítica. Deseja continuar?'
      : 'Este termo já possui uma versão assinada enviada. Ao regenerar, o documento assinado existente ficará desatualizado. Deseja continuar?'
    : tipo === 'contrato'
      ? 'Será gerado um novo Contrato Mãe, substituindo a versão atual. Deseja continuar?'
      : 'Será gerado um novo Termo de Cessão, substituindo a versão atual. Deseja continuar?'

  const isCritico = hasSignedDoc && tipo === 'contrato'

  if (currentPath) {
    return (
      <div className={`flex flex-col gap-2${className ? ' ' + className : ''}`}>
        <div className="flex items-center gap-2">
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
            onClick={handleClickRegerar}
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

        {showConfirm && (
          <div className={`rounded-lg border p-3 text-xs space-y-2 ${
            isCritico
              ? 'bg-red-50 border-red-300 text-red-800'
              : 'bg-amber-50 border-amber-300 text-amber-800'
          }`}>
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <p>{mensagemConfirmacao}</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setShowConfirm(false)}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                className={`h-7 text-xs text-white ${isCritico ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}
                onClick={handleGerar}
                disabled={gerando}
              >
                {gerando ? <Loader2 size={12} className="animate-spin" /> : null}
                Confirmar
              </Button>
            </div>
          </div>
        )}
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
