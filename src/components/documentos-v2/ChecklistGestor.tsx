'use client'

import { useCallback, useEffect, useState } from 'react'
import { analisarVersaoDocumento, baixarVersaoDocumento, listarChecklistDaNota, type ChecklistDocumento } from '@/lib/actions/documento-v2'
import { CheckCircle, Download, FileText, Loader2, XCircle } from 'lucide-react'

export function ChecklistGestor({ notaFiscalId }: { notaFiscalId: string }) {
  const [checklist, setChecklist] = useState<ChecklistDocumento | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const load = useCallback(async () => { try { setChecklist(await listarChecklistDaNota(notaFiscalId)) } catch (error) { setMessage(error instanceof Error ? error.message : 'Nao foi possivel carregar o checklist.') } finally { setLoading(false) } }, [notaFiscalId])
  useEffect(() => { void load() }, [load])

  const analyze = async (versionId: string, result: 'aprovado' | 'rejeitado' | 'requer_ajuste') => {
    const observation = result === 'aprovado' ? undefined : window.prompt('Informe o motivo da pendencia:') || ''
    if (result !== 'aprovado' && !(observation || '').trim()) return
    setProcessing(versionId); setMessage('')
    const response = await analisarVersaoDocumento(versionId, result, observation || undefined)
    setMessage(response.success ? 'Analise registrada.' : response.message || 'Falha na analise.')
    if (response.success) await load()
    setProcessing(null)
  }

  const download = async (versionId: string) => {
    const response = await baixarVersaoDocumento(versionId)
    if (response.success && response.url) window.open(response.url, '_blank', 'noopener,noreferrer')
    else setMessage(response.message || 'Falha no download.')
  }

  if (loading) return <div className="rounded-xl border p-4 text-sm text-muted-foreground">Carregando checklist documental...</div>
  if (!checklist || checklist.items.length === 0) return null
  return <section className="mb-6 rounded-xl border bg-card p-5">
    <div className="mb-4 flex items-start justify-between"><div><h2 className="font-semibold">Checklist documental pre-cessao</h2><p className="text-sm text-muted-foreground">Aprovacao e registrada por versao, sem sobrescrita.</p></div><span className={`rounded-full px-2 py-1 text-xs ${checklist.elegibilidade.elegivel ? 'bg-success/15 text-success-foreground' : 'bg-warning/15 text-warning-foreground'}`}>{checklist.elegibilidade.elegivel ? 'Elegivel' : 'Com pendencias'}</span></div>
    {message && <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm">{message}</p>}
    <div className="space-y-3">{checklist.items.map((item) => <div key={item.id} className="rounded-lg border p-3">
      <div className="flex items-center gap-2"><FileText size={17} /><span className="font-medium">{item.nome}</span><span className="ml-auto text-xs text-muted-foreground">{item.status}</span></div>
      {item.versoes.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Nenhuma versao recebida.</p>}
      <div className="mt-2 space-y-2">{item.versoes.map((version) => <div key={version.id} className="flex flex-wrap items-center gap-2 rounded bg-muted/50 px-2 py-2 text-xs">
        <span className="font-medium">v{version.numero}</span><span>{version.nome}</span><span className="text-muted-foreground">{version.status}</span><span className="font-mono text-muted-foreground">{version.sha256.slice(0, 12)}...</span>
        <button className="ml-auto inline-flex items-center gap-1 text-primary hover:underline" onClick={() => void download(version.id)}><Download size={13} />Baixar</button>
        {version.status !== 'aprovado' && <><button disabled={processing === version.id} className="inline-flex items-center gap-1 text-success-foreground hover:underline disabled:opacity-50" onClick={() => void analyze(version.id, 'aprovado')}><CheckCircle size={13} />Aprovar</button><button disabled={processing === version.id} className="inline-flex items-center gap-1 text-destructive hover:underline disabled:opacity-50" onClick={() => void analyze(version.id, 'rejeitado')}><XCircle size={13} />Rejeitar</button>{processing === version.id && <Loader2 size={13} className="animate-spin" />}</>}
      </div>)}</div>
    </div>)}</div>
  </section>
}
