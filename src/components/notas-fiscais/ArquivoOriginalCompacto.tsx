'use client'

import { useEffect, useState } from 'react'
import { Download, ExternalLink, Eye, FileText, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FilePreviewContent } from '@/components/notas-fiscais/FilePreviewContent'
import { listarArquivosOriginaisNotaFiscal, obterAcessoArquivoFiscal } from '@/lib/actions/arquivos-fiscais'
import { baixarArquivoFiscal } from '@/lib/notas-fiscais/arquivo-fiscal-client'
import type { ArquivoFiscalResumo } from '@/lib/notas-fiscais/arquivo-fiscal'

function ArquivoFiscalCard({ notaFiscalId, arquivo }: { notaFiscalId: string; arquivo: ArquivoFiscalResumo }) {
  const [preview, setPreview] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const label = arquivo.tipo === 'Arquivo' ? 'arquivo' : arquivo.tipo

  async function open(mode: 'preview' | 'download' | 'tab') {
    setWorking(true)
    setError('')
    try {
      const result = await obterAcessoArquivoFiscal(notaFiscalId, arquivo.id)
      if (!result.success) { setError(result.message); return }
      if (mode === 'download') await baixarArquivoFiscal(result.url, result.arquivo.nome)
      else if (mode === 'tab') window.open(result.url, '_blank', 'noopener,noreferrer')
      else setPreview(result.url)
    } catch {
      setError('Não foi possível abrir ou baixar o arquivo. Tente novamente.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <article className="min-w-0 rounded-xl border bg-card p-4" aria-label={`${arquivo.tipo} — ${arquivo.nome}`}>
      <div className="flex items-start gap-3">
        <FileText size={20} className="mt-1 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h4 className="break-words font-semibold">{arquivo.tipo}{arquivo.id === 'original' ? ' original' : ''}</h4>
          <p className="truncate text-sm text-muted-foreground" title={arquivo.nome}>{arquivo.nome}</p>
          {arquivo.numeroVersao !== null && <p className="text-xs text-muted-foreground">Versão {arquivo.numeroVersao}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 [&>button]:max-w-full [&>button]:h-auto [&>button]:min-h-8 [&>button]:whitespace-normal [&>button]:text-left">
        <Button type="button" variant="outline" size="sm" disabled={working} onClick={() => void open('preview')}>
          {working ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
          Visualizar {label}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={working} onClick={() => void open('download')}>
          <Download size={14} />Baixar {label}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={working} onClick={() => void open('tab')}>
          <ExternalLink size={14} />Abrir em nova aba
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(null) }}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-5xl" showCloseButton={false}>
          <DialogHeader className="pr-8">
            <DialogTitle>{arquivo.tipo}{arquivo.id === 'original' ? ' original' : ''}</DialogTitle>
            <DialogDescription>{arquivo.nome}</DialogDescription>
          </DialogHeader>
          <Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2" aria-label="Fechar preview" onClick={() => setPreview(null)}><X size={18} /></Button>
          {preview && <FilePreviewContent url={preview} filePath={arquivo.nome} mimeType={arquivo.mimeType} title={arquivo.nome} />}
        </DialogContent>
      </Dialog>
    </article>
  )
}

type ListaState = { notaFiscalId: string; arquivos: ArquivoFiscalResumo[]; error: string }

export function ArquivoOriginalCompacto({ notaFiscalId, title = 'Arquivos originais' }: { notaFiscalId: string; title?: string }) {
  const [state, setState] = useState<ListaState | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void listarArquivosOriginaisNotaFiscal(notaFiscalId).then(result => {
      if (active) setState({ notaFiscalId, arquivos: result.success ? result.arquivos : [], error: result.success ? '' : result.message })
    }).catch(() => {
      if (active) setState({ notaFiscalId, arquivos: [], error: 'Não foi possível carregar os arquivos.' })
    })
    return () => { active = false }
  }, [notaFiscalId, attempt])

  if (!state || state.notaFiscalId !== notaFiscalId) return <p role="status" className="text-sm text-muted-foreground">Carregando arquivos originais...</p>
  if (state.error) return <div role="alert" className="rounded-xl border p-4"><p className="text-sm">{state.error}</p><Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { setState(null); setAttempt(a => a + 1) }}>Tentar novamente</Button></div>
  if (!state.arquivos.length) return null
  return (
    <section aria-label={title} className="space-y-3">
      <h3 className="font-semibold">{title}</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
        {state.arquivos.map(arquivo => <ArquivoFiscalCard key={`${notaFiscalId}:${arquivo.id}`} notaFiscalId={notaFiscalId} arquivo={arquivo} />)}
      </div>
    </section>
  )
}
