'use client'

import { ChangeEvent, DragEvent, KeyboardEvent, useRef, useState } from 'react'
import { FileText, Loader2, Upload, X } from 'lucide-react'

interface DocumentDropzoneProps {
  accept?: string
  disabled?: boolean
  multiple?: boolean
  sending?: boolean
  label?: string
  description?: string
  error?: string
  onUpload: (file: File) => Promise<void> | void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function DocumentDropzone({
  accept,
  disabled,
  multiple = false,
  sending,
  label = 'Arraste o arquivo aqui ou clique para selecionar',
  description = 'O arquivo sera validado no servidor antes do registro documental.',
  error,
  onUpload,
}: DocumentDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [localError, setLocalError] = useState('')

  const selectFile = (file: File | null | undefined) => {
    if (!file || disabled || sending) return
    setLocalError('')
    setSelectedFile(file)
  }

  const clearSelection = () => {
    setSelectedFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const submitFile = async () => {
    if (!selectedFile || disabled || sending) return
    setLocalError('')
    try {
      await onUpload(selectedFile)
      clearSelection()
    } catch (uploadError) {
      setLocalError(uploadError instanceof Error ? uploadError.message : 'Nao foi possivel enviar o arquivo.')
    }
  }

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    if (!multiple && files.length > 1) {
      setLocalError('Este requisito aceita apenas um arquivo por envio.')
      event.currentTarget.value = ''
      return
    }
    selectFile(files[0])
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    const files = Array.from(event.dataTransfer.files || [])
    if (!multiple && files.length > 1) {
      setLocalError('Este requisito aceita apenas um arquivo por envio.')
      return
    }
    selectFile(files[0])
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      inputRef.current?.click()
    }
  }

  const message = error || localError

  return (
    <div className="mt-3">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || sending}
        onClick={() => !disabled && !sending && inputRef.current?.click()}
        onKeyDown={onKeyDown}
        onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }}
        onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }}
        onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
        onDrop={onDrop}
        className={[
          'rounded-xl border border-dashed p-4 transition outline-none',
          disabled ? 'cursor-not-allowed bg-muted/40 opacity-60' : 'cursor-pointer hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring',
          dragging ? 'border-primary bg-primary/5' : 'border-border bg-background',
        ].join(' ')}
      >
        <input ref={inputRef} type="file" accept={accept} multiple={multiple} disabled={disabled || sending} className="hidden" onChange={onChange} />
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {sending ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{sending ? 'Enviando arquivo...' : label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            {selectedFile && (
              <div className="mt-3 rounded-lg border bg-card px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText size={14} className="shrink-0" />
                    <span className="truncate">{selectedFile.name}</span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(selectedFile.size)}</span>
                </div>
                {!sending && (
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      className="rounded-md border px-3 py-1.5 font-medium hover:bg-muted"
                      onClick={(event) => {
                        event.stopPropagation()
                        clearSelection()
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:bg-primary/90"
                      onClick={(event) => {
                        event.stopPropagation()
                        void submitFile()
                      }}
                    >
                      Enviar arquivo
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          {selectedFile && !sending && (
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              onClick={(event) => {
                event.stopPropagation()
                clearSelection()
              }}
              aria-label="Cancelar arquivo selecionado"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>
      {message && <p className="mt-2 text-xs text-destructive">{message}</p>}
    </div>
  )
}
