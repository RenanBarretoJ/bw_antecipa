'use client'

import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { selecionarArquivoSolto } from '@/lib/documentos/arquivo-solto'

export function AreaSoltarDocumento({ children, className, habilitado, bloqueado, aceitar, onArquivo, onErro }: {
  children: ReactNode
  className?: string
  habilitado: boolean
  bloqueado: boolean
  aceitar: string
  onArquivo: (arquivo: File) => Promise<void>
  onErro: (mensagem: string) => void
}) {
  const [arrastando, setArrastando] = useState(false)
  const profundidade = useRef(0)
  const recebendo = useRef(false)
  const temArquivo = (event: DragEvent<HTMLDivElement>) => Array.from(event.dataTransfer.types).includes('Files')

  const receber = async (event: DragEvent<HTMLDivElement>) => {
    if (!temArquivo(event)) return
    event.preventDefault()
    event.stopPropagation()
    profundidade.current = 0
    setArrastando(false)
    if (bloqueado || recebendo.current) return
    try {
      const arquivo = selecionarArquivoSolto(Array.from(event.dataTransfer.files), aceitar)
      if (!arquivo) return
      recebendo.current = true
      await onArquivo(arquivo)
    } catch (error) {
      onErro(error instanceof Error ? error.message : 'Não foi possível receber o arquivo.')
    } finally {
      recebendo.current = false
    }
  }

  return <div
    className={cn(className, arrastando && !bloqueado && 'bg-primary/5 outline-2 -outline-offset-2 outline-primary')}
    title={habilitado ? 'Solte um arquivo aqui ou use Anexar.' : undefined}
    data-documento-drop={habilitado ? '' : undefined}
    aria-busy={habilitado ? bloqueado : undefined}
    onDragEnter={habilitado ? event => {
      if (!temArquivo(event)) return
      event.preventDefault()
      event.stopPropagation()
      profundidade.current++
      if (!bloqueado) setArrastando(true)
    } : undefined}
    onDragOver={habilitado ? event => {
      if (!temArquivo(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = bloqueado || recebendo.current ? 'none' : 'copy'
    } : undefined}
    onDragLeave={habilitado ? event => {
      if (!temArquivo(event)) return
      event.preventDefault()
      event.stopPropagation()
      profundidade.current = Math.max(0, profundidade.current - 1)
      if (!profundidade.current) setArrastando(false)
    } : undefined}
    onDrop={habilitado ? receber : undefined}
  >{children}</div>
}
