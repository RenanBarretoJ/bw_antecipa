'use client'

import { useCallback, useEffect, useState } from 'react'
import { listarChecklistDaNota, enviarDocumentoDaNota, type ChecklistDocumento } from '@/lib/actions/documento-v2'
import { CheckCircle, Clock, FileText, Loader2, Upload, XCircle } from 'lucide-react'

const labels: Record<string, string> = {
  pendente: 'Pendente', enviado: 'Enviado', em_analise: 'Em analise', aprovado: 'Aprovado', rejeitado: 'Rejeitado', satisfeito: 'Satisfeito',
}

export function ChecklistCedente({ notaFiscalId }: { notaFiscalId: string }) {
  const [checklist, setChecklist] = useState<ChecklistDocumento | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    try { setChecklist(await listarChecklistDaNota(notaFiscalId)) } catch (error) { setMessage(error instanceof Error ? error.message : 'Nao foi possivel carregar o checklist.') } finally { setLoading(false) }
  }, [notaFiscalId])
  useEffect(() => { void load() }, [load])

  const upload = async (requirementId: string, file: File) => {
    setSending(requirementId); setMessage('')
    const form = new FormData(); form.set('notaFiscalId', notaFiscalId); form.set('requisitoId', requirementId); form.set('arquivo', file)
    const result = await enviarDocumentoDaNota(form)
    setMessage(result.message || '')
    if (result.success) await load()
    setSending(null)
  }

  if (loading) return <div className="rounded-xl border p-4 text-sm text-muted-foreground">Carregando checklist documental...</div>
  if (!checklist || checklist.items.length === 0) return null

  return (
    <section className="mb-6 rounded-xl border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h2 className="font-semibold">Documentos pre-cessao</h2><p className="text-sm text-muted-foreground">Cada documento e analisado por versao.</p></div>
        <span className={`rounded-full px-2 py-1 text-xs font-medium ${checklist.elegibilidade.elegivel ? 'bg-success/15 text-success-foreground' : 'bg-warning/15 text-warning-foreground'}`}>
          {checklist.elegibilidade.elegivel ? 'Elegivel documentalmente' : 'Pendencias documentais'}
        </span>
      </div>
      {message && <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm">{message}</p>}
      <div className="space-y-3">
        {checklist.items.map((item) => {
          const approved = item.status === 'satisfeito'
          return <div key={item.id} className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2"><FileText size={17} /><span className="font-medium">{item.nome}</span>{item.obrigatorio && <span className="text-xs text-muted-foreground">obrigatorio</span>}</div>
              <span className={`flex items-center gap-1 text-xs ${approved ? 'text-success-foreground' : item.status === 'rejeitado' ? 'text-destructive' : 'text-warning-foreground'}`}>
                {approved ? <CheckCircle size={14} /> : item.status === 'rejeitado' ? <XCircle size={14} /> : <Clock size={14} />}{labels[item.status] || item.status}
              </span>
            </div>
            {!approved && item.uploadPermitido && <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-primary hover:underline">
              {sending === item.id ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {item.versoes.length ? 'Enviar nova versao' : 'Enviar arquivo'}
              <input type="file" className="hidden" disabled={sending === item.id} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(item.id, file); event.currentTarget.value = '' }} />
            </label>}
            {!item.uploadPermitido && <p className="mt-2 text-xs text-muted-foreground">Tipo ainda nao catalogado para upload nesta fase.</p>}
            {item.versoes.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{item.versoes.length} versao(oes) registrada(s).</p>}
          </div>
        })}
      </div>
    </section>
  )
}
