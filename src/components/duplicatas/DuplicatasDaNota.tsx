'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileText, History, Upload, XCircle } from 'lucide-react'
import {
  concluirValidacaoDuplicata,
  corrigirCamposDuplicata,
  enviarDuplicataPdf,
  listarDuplicatasDaNota,
  obterUrlDuplicata,
  type DuplicataComVersoes,
  type DuplicatasDaNotaResult,
} from '@/lib/actions/duplicata'
import type { CamposDuplicata } from '@/lib/duplicatas/types'
import type { EvidenciaExtracaoDuplicata, NotaFiscalParaConfronto } from '@/lib/duplicatas/types'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { formatCurrency, formatDate } from '@/lib/utils'

type ViewerMode = 'cedente' | 'gestor'

const STATUS_LABELS: Record<string, string> = {
  RASCUNHO: 'Rascunho',
  EXTRAIDA: 'Extraida - aguardando validacao',
  REVISAR: 'Revisar campos',
  VALIDADA: 'Validada',
  REJEITADA: 'Rejeitada',
}

function campos(row: DuplicataComVersoes): CamposDuplicata {
  return {
    numero: row.numero,
    numero_fatura: row.numero_fatura,
    parcela: row.parcela,
    data_emissao: row.data_emissao,
    data_vencimento: row.data_vencimento,
    valor_nominal: row.valor_nominal,
    nome_cedente_documento: row.nome_cedente_documento,
    cnpj_cedente_documento: row.cnpj_cedente_documento,
    nome_sacado_documento: row.nome_sacado_documento,
    cnpj_sacado_documento: row.cnpj_sacado_documento,
    local_pagamento: row.local_pagamento,
    aceite_textual: row.aceite_textual,
    aceite_detectado_textualmente: row.aceite_detectado_textualmente,
  }
}

function valorDaNota(field: keyof CamposDuplicata, nota: NotaFiscalParaConfronto): string {
  const values: Partial<Record<keyof CamposDuplicata, string>> = {
    numero: nota.numero_nf,
    data_emissao: formatDate(nota.data_emissao),
    data_vencimento: formatDate(nota.data_vencimento),
    valor_nominal: formatCurrency(Number(nota.valor_bruto)),
    nome_cedente_documento: nota.razao_social_emitente || '',
    cnpj_cedente_documento: nota.cnpj_emitente,
    nome_sacado_documento: nota.razao_social_destinatario || '',
    cnpj_sacado_documento: nota.cnpj_destinatario,
  }
  return values[field] || 'Sem equivalente direto na NF'
}

function DuplicataItem({
  notaFiscalId,
  item,
  nota,
  mode,
  editable,
  onChanged,
  onUploadVersion,
}: {
  notaFiscalId: string
  item: DuplicataComVersoes
  nota: NotaFiscalParaConfronto
  mode: ViewerMode
  editable: boolean
  onChanged: () => Promise<void>
  onUploadVersion: (duplicataId: string) => void
}) {
  const notifications = useNotifications()
  const [draft, setDraft] = useState<CamposDuplicata>(() => campos(item))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const currentVersion = item.versoes[0]
  const blocking = item.validacao.bloqueios.length
  const warnings = item.validacao.avisos.length
  const evidencias = Object.values(currentVersion?.evidencias || {}) as EvidenciaExtracaoDuplicata[]
  const canCorrect = item.status_validacao !== 'VALIDADA'
    && item.status_validacao !== 'REJEITADA'
    && ((mode === 'cedente' && editable) || mode === 'gestor')

  const update = (field: keyof CamposDuplicata, value: string) => {
    setDraft((current) => ({
      ...current,
      [field]: field === 'valor_nominal' ? (value === '' ? null : Number(value)) : (value || (field === 'parcela' ? '' : null)),
    }))
  }

  const openPdf = async (versionId: string) => {
    const result = await obterUrlDuplicata(notaFiscalId, versionId)
    if (!result.success || !result.data?.url) return notifications.error(result.details || result.message)
    window.open(result.data.url, '_blank', 'noopener,noreferrer')
  }

  const save = async () => {
    if (!reason.trim()) return notifications.warning('Informe o motivo da revisao dos campos.')
    setBusy(true)
    const result = await corrigirCamposDuplicata(notaFiscalId, item.id, draft, reason)
    notifications.fromActionResult(result)
    if (result.success) {
      setReason('')
      await onChanged()
    }
    setBusy(false)
  }

  const validate = async (resultValue: 'VALIDADA' | 'REJEITADA') => {
    const observation = resultValue === 'REJEITADA'
      ? window.prompt('Informe o motivo da rejeicao:')?.trim()
      : undefined
    if (resultValue === 'REJEITADA' && !observation) return
    setBusy(true)
    const result = await concluirValidacaoDuplicata(notaFiscalId, item.id, resultValue, observation)
    notifications.fromActionResult(result)
    if (result.success) await onChanged()
    setBusy(false)
  }

  return (
    <article className="rounded-xl border bg-card">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText size={18} /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="font-semibold">Duplicata {item.numero || 'sem numero'}</h4>
              <Badge variant={item.status_validacao === 'REJEITADA' ? 'destructive' : 'outline'}>{STATUS_LABELS[item.status_validacao] || item.status_validacao}</Badge>
              <Badge variant="outline">{item.resultado_confronto}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {currentVersion ? `v${currentVersion.numero_versao} · ${currentVersion.nome_original} · ${formatDate(currentVersion.enviado_em)}` : 'Sem versao documental'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {currentVersion && <Button size="sm" variant="outline" onClick={() => openPdf(currentVersion.id)}>Ver PDF</Button>}
          {mode === 'cedente' && editable && <Button size="sm" variant="outline" onClick={() => onUploadVersion(item.id)}><Upload size={14} /> Nova versao</Button>}
          {mode === 'gestor' && item.status_validacao !== 'VALIDADA' && (
            <Button size="sm" onClick={() => validate('VALIDADA')} disabled={busy || blocking > 0}><CheckCircle2 size={14} /> Validar</Button>
          )}
          {mode === 'gestor' && item.status_validacao !== 'REJEITADA' && (
            <Button size="sm" variant="destructive" onClick={() => validate('REJEITADA')} disabled={busy}><XCircle size={14} /> Rejeitar</Button>
          )}
        </div>
      </div>

      <div className="border-t p-4">
        {(blocking > 0 || warnings > 0) && (
          <div className="mb-4 grid gap-2">
            {item.validacao.bloqueios.map((issue) => <p key={issue.codigo} className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"><XCircle className="mt-0.5 size-4 shrink-0" />{issue.mensagem}</p>)}
            {item.validacao.avisos.map((issue) => <p key={issue.codigo} className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-foreground"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{issue.mensagem}</p>)}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ['numero', 'Numero', true], ['numero_fatura', 'Fatura', true], ['parcela', 'Parcela', true],
            ['data_emissao', 'Emissao', true], ['data_vencimento', 'Vencimento', true],
            ['valor_nominal', 'Valor nominal', true], ['nome_cedente_documento', 'Cedente no documento', true],
            ['cnpj_cedente_documento', 'CNPJ cedente', true], ['nome_sacado_documento', 'Sacado no documento', true],
            ['cnpj_sacado_documento', 'CNPJ sacado', true], ['local_pagamento', 'Local de pagamento', true],
            ['aceite_textual', 'Texto de aceite', true], ['aceite_detectado_textualmente', 'Aceite detectado textualmente', false],
          ] as Array<[keyof CamposDuplicata, string, boolean]>).map(([field, label, canEdit]) => (
            <div key={field} className={field === 'aceite_textual' || field === 'local_pagamento' ? 'lg:col-span-2' : ''}>
              <Label htmlFor={`${item.id}-${field}`}>{label}</Label>
              {canCorrect && canEdit ? (
                <Input
                  id={`${item.id}-${field}`}
                  className="mt-1"
                  type={field === 'valor_nominal' ? 'number' : field.startsWith('data_') ? 'date' : 'text'}
                  step={field === 'valor_nominal' ? '0.01' : undefined}
                  value={draft[field] ?? ''}
                  onChange={(event) => update(field, event.target.value)}
                />
              ) : (
                <p className="mt-1 min-h-8 rounded-lg bg-muted/40 px-2.5 py-1.5 text-sm">
                  {field === 'valor_nominal' && draft[field] !== null ? formatCurrency(Number(draft[field])) : String(draft[field] || 'Nao informado')}
                </p>
              )}
              <p className="mt-1 truncate text-xs text-muted-foreground" title={valorDaNota(field, nota)}>
                NF: {valorDaNota(field, nota)}
              </p>
            </div>
          ))}
        </div>

        {canCorrect && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1"><Label htmlFor={`${item.id}-reason`}>Motivo da revisao</Label><Input id={`${item.id}-reason`} className="mt-1" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: campo nao identificado no PDF" /></div>
            <Button onClick={save} disabled={busy}>Salvar revisao</Button>
          </div>
        )}

        {item.versoes.length > 1 && (
          <details className="mt-4 rounded-lg border px-3 py-2">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><History size={14} /> {item.versoes.length} versoes</summary>
            <div className="mt-2 divide-y">
              {item.versoes.map((version) => (
                <div key={version.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">v{version.numero_versao} · {version.nome_original}</span>
                  <Button size="sm" variant="ghost" onClick={() => openPdf(version.id)}>Ver</Button>
                </div>
              ))}
            </div>
          </details>
        )}

        {(evidencias.length > 0 || item.correcoes.length > 0 || item.validacoes.length > 0) && (
          <details className="mt-4 rounded-lg border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">Evidencias e trilha de revisao</summary>
            <div className="mt-3 space-y-3 text-xs">
              {evidencias.length > 0 && (
                <div>
                  <p className="font-medium">Extracao da versao atual</p>
                  <div className="mt-1 divide-y rounded-md border">
                    {evidencias.map((evidence) => (
                      <div key={evidence.campo} className="grid gap-1 px-2 py-2 sm:grid-cols-[10rem_1fr_auto]">
                        <span>{evidence.campo}</span>
                        <span className="min-w-0 break-words text-muted-foreground">{evidence.trechoFonte}</span>
                        <span>{Math.round(evidence.confianca * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {item.correcoes.map((correction) => (
                <p key={correction.id} className="text-muted-foreground">
                  Campo {correction.campo} corrigido em {formatDate(correction.corrigido_em)}. Motivo: {correction.motivo}
                </p>
              ))}
              {item.validacoes.map((validation) => (
                <p key={validation.id} className="text-muted-foreground">
                  {validation.resultado === 'VALIDADA' ? 'Validada' : 'Rejeitada'} em {formatDate(validation.validado_em)}{validation.observacoes ? `: ${validation.observacoes}` : '.'}
                </p>
              ))}
            </div>
          </details>
        )}
      </div>
    </article>
  )
}

export function DuplicatasDaNota({ notaFiscalId, mode, editable = false }: { notaFiscalId: string; mode: ViewerMode; editable?: boolean }) {
  const notifications = useNotifications()
  const inputRef = useRef<HTMLInputElement>(null)
  const [data, setData] = useState<DuplicatasDaNotaResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [targetDuplicataId, setTargetDuplicataId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await listarDuplicatasDaNota(notaFiscalId)
    if (!result.success) notifications.error(result.details || result.message)
    setData(result.data || null)
    setLoading(false)
  }, [notaFiscalId, notifications])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const upload = async (file?: File) => {
    if (!file) return
    setUploading(true)
    const form = new FormData()
    form.set('arquivo', file)
    if (targetDuplicataId) form.set('duplicataId', targetDuplicataId)
    const result = await enviarDuplicataPdf(notaFiscalId, form)
    notifications.fromActionResult(result)
    if (result.success) await load()
    setTargetDuplicataId(null)
    if (inputRef.current) inputRef.current.value = ''
    setUploading(false)
  }

  const openUpload = (duplicataId: string | null = null) => {
    setTargetDuplicataId(duplicataId)
    inputRef.current?.click()
  }

  const validated = useMemo(() => data?.duplicatas.filter((item) => item.status_validacao === 'VALIDADA').length || 0, [data])
  if (loading || !data?.habilitado) return null

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4" aria-labelledby="duplicatas-title">
      <input ref={inputRef} className="sr-only" type="file" accept="application/pdf,.pdf" onChange={(event) => upload(event.target.files?.[0])} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="duplicatas-title" className="font-semibold">Duplicatas Mercantis</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ativos financeiros vinculados a esta NF, que permanece como lastro fiscal.</p>
        </div>
        {mode === 'cedente' && editable && <Button onClick={() => openUpload()} disabled={uploading}><Upload size={16} /> {uploading ? 'Processando PDF...' : 'Enviar duplicata em PDF'}</Button>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border p-3"><p className="text-xs uppercase text-muted-foreground">Titulos</p><p className="mt-1 text-lg font-semibold">{data.agregado.quantidade}</p></div>
        <div className="rounded-lg border p-3"><p className="text-xs uppercase text-muted-foreground">Validados</p><p className="mt-1 text-lg font-semibold">{validated}</p></div>
        <div className="rounded-lg border p-3"><p className="text-xs uppercase text-muted-foreground">Valor nominal total</p><p className="mt-1 text-lg font-semibold">{formatCurrency(data.agregado.valorNominalTotal)}</p></div>
        <div className="rounded-lg border p-3"><p className="text-xs uppercase text-muted-foreground">Confronto agregado</p><p className="mt-1 text-lg font-semibold">{data.agregado.resultado}</p></div>
      </div>

      {data.duplicatas.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma duplicata enviada para esta NF.</div>
      ) : (
        <div className="space-y-3">
          {data.duplicatas.map((item) => <DuplicataItem key={`${item.id}:${item.updated_at}:${item.versao_atual_id}`} notaFiscalId={notaFiscalId} item={item} nota={data.nota} mode={mode} editable={editable} onChanged={load} onUploadVersion={(id) => openUpload(id)} />)}
        </div>
      )}
    </section>
  )
}
