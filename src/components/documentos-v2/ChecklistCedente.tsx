'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  analisarVersaoDocumento,
  baixarVersaoDocumento,
  enviarDocumentoDaNota,
  listarChecklistDaNota,
  type ChecklistDocumento,
  type ChecklistDocumentoItem,
} from '@/lib/actions/documento-v2'
import { comunicarPostergacaoUploadCanhoto } from '@/lib/actions/postergacao-canhoto'
import { validarNovaPrevisaoCanhoto, type StatusPrazoUploadCanhoto } from '@/lib/logistica/postergacao-canhoto'
import { AlertTriangle, CalendarClock, CheckCircle, ChevronDown, ChevronUp, Clock, Eye, FileText, Loader2, MoreVertical, ShieldAlert, Truck, Upload, XCircle } from 'lucide-react'
import { DocumentDropzone } from './DocumentDropzone'
import { ParcelasBoletosNota } from './ParcelasBoletosNota'
import { RequisitoNfRemessa } from './RequisitoNfRemessa'
import { RequisitoComprovanteEntrega } from './RequisitoComprovanteEntrega'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNotifications } from '@/components/notifications/notification-provider'

type ChecklistMode = 'cedente' | 'gestor'

const labels: Record<string, string> = {
  pendente: 'Pendente',
  enviado: 'Enviado',
  em_analise: 'Enviado — aguardando análise',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  satisfeito: 'Satisfeito',
  vencido: 'Vencido',
  dispensado: 'Dispensado',
  cancelado: 'Cancelado',
}

const resumoPosLabels: Record<string, string> = {
  nao_iniciado: 'Não iniciado',
  pendente: 'Pendências documentais',
  em_analise: 'Aguardando análise',
  vencido: 'Prazo vencido',
  concluido: 'Concluído',
}

const logisticoLabels: Record<ChecklistDocumento['resumoOperacional']['statusLogistico'], string> = {
  nao_iniciado: 'Não iniciado',
  aguardando_desembolso: 'Aguardando desembolso',
  em_transito: 'Em trânsito',
  aguardando_comprovante: 'Aguardando comprovante',
  documento_enviado: 'Documento enviado',
  em_analise: 'Em análise',
  entrega_confirmada: 'Entrega confirmada',
  em_atraso: 'Em atraso',
  cancelada: 'Cancelada',
  devolvida: 'Devolvida',
}

const prazoCanhotoLabels: Record<StatusPrazoUploadCanhoto, string> = {
  sem_prazo: 'Sem prazo',
  pendente: 'Dentro do prazo',
  vence_hoje: 'Vence hoje',
  vencido: 'Prazo vencido',
  atendido_no_prazo: 'Upload no prazo',
  atendido_em_atraso: 'Upload em atraso',
}

function acceptedFromFormats(formats?: string[]): string | undefined {
  if (!formats?.length) return undefined
  return formats.map((format) => {
    const ext = format.startsWith('.') ? format : `.${format.replace(/^\*?\./, '')}`
    return ext.toLowerCase()
  }).join(',')
}

export function isDocumentoAprovado(item: Pick<ChecklistDocumentoItem, 'versaoAprovadaId' | 'versoes'>) {
  const latest = item.versoes[0]
  if (!latest) return false
  if (item.versaoAprovadaId === latest.id) return true
  if (latest.status === 'aprovado') return true
  return latest.ultimaAnalise?.resultado === 'aprovado'
}

export function canAnalyzeDocumentVersion(mode: ChecklistMode, versionStatus: string | null | undefined) {
  return mode === 'gestor'
    && Boolean(versionStatus)
    && !['aprovado', 'substituido', 'cancelado'].includes(String(versionStatus))
}

export function statusVisual(item: ChecklistDocumentoItem) {
  const latest = item.versoes[0]
  const latestAnalysis = latest?.ultimaAnalise?.resultado
  if (isDocumentoAprovado(item)) return { label: 'Aprovado', tone: 'text-success-foreground bg-success/15', icon: CheckCircle }
  if (item.status === 'vencido' || item.statusPrazo === 'vencido') return { label: 'Vencido', tone: 'text-destructive bg-destructive/10', icon: XCircle }
  if (latest?.status === 'rejeitado' || latestAnalysis === 'rejeitado' || latestAnalysis === 'requer_ajuste') return { label: 'Rejeitado', tone: 'text-destructive bg-destructive/10', icon: XCircle }
  if (latest?.status === 'em_analise' || latest?.status === 'enviado') return { label: 'Aguardando análise', tone: 'text-info-foreground bg-info/15', icon: Clock }
  return { label: labels[item.status] || item.status, tone: 'text-warning-foreground bg-warning/15', icon: Clock }
}

function logisticalTone(status: ChecklistDocumento['resumoOperacional']['statusLogistico']) {
  if (status === 'entrega_confirmada') return 'bg-success/15 text-success-foreground'
  if (status === 'em_atraso' || status === 'cancelada' || status === 'devolvida') return 'bg-destructive/10 text-destructive'
  if (status === 'em_transito' || status === 'documento_enviado' || status === 'em_analise') return 'bg-info/15 text-info-foreground'
  return 'bg-warning/15 text-warning-foreground'
}

function formatDateBR(value: string | null): string | null {
  if (!value) return null
  const [date, time] = value.split('T')
  const parts = date.split('-')
  if (parts.length !== 3) return value
  const formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`
  return time ? `${formattedDate}, ${time.slice(0, 5)}` : formattedDate
}

export function shouldShowPrazoBlock(item: Pick<ChecklistDocumentoItem, 'dataLimite' | 'prazoDetalhe' | 'statusPrazo' | 'marcoPrazo'>) {
  if (!item.dataLimite) return false
  if (item.statusPrazo === 'nao_iniciado') return false
  if ((item.prazoDetalhe || '').toLowerCase() === 'não iniciado') return false
  if (!item.marcoPrazo) return false
  return true
}

export function compactHistorySummary(item: Pick<ChecklistDocumentoItem, 'versoes'>) {
  const latest = item.versoes[0]
  if (!latest) return 'Nenhuma versão enviada'
  if (item.versoes.length === 1) return `v${latest.numero} · ${latest.nome} · enviado em ${formatDateBR(latest.enviadoEm) || '—'}`
  return `${item.versoes.length} versões · Ver histórico`
}

function TechnicalDetails({ version }: { version: ChecklistDocumentoItem['versoes'][number] }) {
  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-foreground">Detalhes técnicos</summary>
      <div className="mt-2 grid gap-1 rounded-lg border bg-background p-2 font-mono">
        <span>Versão: {version.id}</span>
        <span>SHA-256: {version.sha256}</span>
        <span>Enviado por: {version.enviadoPorNome || version.enviadoPorId}</span>
      </div>
    </details>
  )
}

type RequirementCardProps = {
  item: ChecklistDocumentoItem
  notaFiscalId: string
  mode: ChecklistMode
  sending: string | null
  processing: string | null
  onUpload: (item: ChecklistDocumentoItem, file: File, notaFiscalIds?: string[]) => Promise<void>
  onDownload: (versionId: string) => Promise<void>
  onAnalyze: (versionId: string, result: 'aprovado' | 'rejeitado' | 'requer_ajuste') => Promise<void>
}

/**
 * nf_remessa nunca usa o fluxo generico de upload/documentos_v2 -- tem
 * componente especializado proprio, com sua fonte real
 * (nota_fiscal_remessas) e vocabulario de status dedicado (regra da
 * consolidacao da UI: "Nao enviada"/"Pendente"/"Validada"/"Em revisao"/
 * "Rejeitada", nunca a mensagem generica de tipo nao catalogado). Este
 * dispatcher fica sem hooks proprios de proposito -- so despacha antes de
 * qualquer useState, para nao violar a ordem de hooks entre os dois
 * componentes (regras de hooks do React).
 */
function RequirementCard(props: RequirementCardProps) {
  if (props.item.codigo === 'nf_remessa') {
    return <RequisitoNfRemessa item={props.item} notaFiscalId={props.notaFiscalId} mode={props.mode} />
  }
  if (props.item.familiaDocumental === 'comprovante_entrega' && props.item.entregaId) {
    return <RequisitoComprovanteEntrega item={props.item} notaFiscalId={props.notaFiscalId} mode={props.mode} />
  }
  return <RequirementCardGeneric {...props} />
}

function RequirementCardGeneric({
  item,
  notaFiscalId,
  mode,
  sending,
  processing,
  onUpload,
  onDownload,
  onAnalyze,
}: RequirementCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [selectedNfIds, setSelectedNfIds] = useState<string[]>([notaFiscalId])
  const visual = statusVisual(item)
  const StatusIcon = visual.icon
  const canUpload = mode === 'cedente' && item.uploadPermitido && !isDocumentoAprovado(item)
  const accept = acceptedFromFormats(item.formatosAceitos)
  const latest = item.versoes[0]
  const canAnalyze = canAnalyzeDocumentVersion(mode, latest?.status)
  const shouldShowUpload = canUpload && (item.versoes.length === 0 || showUpload || visual.label === 'Rejeitado')
  const showPrazo = shouldShowPrazoBlock(item)
  const historySummary = compactHistorySummary(item)
  const ExpandedIcon = expanded ? ChevronUp : ChevronDown

  return (
    <article className="rounded-xl border bg-background">
      <div className="flex flex-col gap-2 px-3 py-2.5 md:min-h-16 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FileText size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold text-foreground">{item.nome}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${item.obrigatorio ? 'bg-warning/15 text-warning-foreground' : 'bg-muted text-muted-foreground'}`}>
                {item.obrigatorio ? 'Obrigatório' : 'Opcional'}
              </span>
              {item.bloqueiaFluxo && mode === 'gestor' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                  <ShieldAlert size={11} /> Bloqueia
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {historySummary}
            </span>
          </span>
        </button>

        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${visual.tone}`}>
            <StatusIcon size={13} />
            {visual.label}
          </span>

          {latest && (
            <Button type="button" size="sm" variant="outline" onClick={() => onDownload(latest.id)}>
              <Eye size={13} />
              Ver
            </Button>
          )}

          {canAnalyze && latest && (
            <>
              <Button type="button" size="sm" onClick={() => onAnalyze(latest.id, 'aprovado')} disabled={processing === latest.id}>
                {processing === latest.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                Aprovar
              </Button>
              <Button type="button" size="sm" variant="destructive" onClick={() => onAnalyze(latest.id, 'rejeitado')} disabled={processing === latest.id}>
                <XCircle size={13} />
                Rejeitar
              </Button>
            </>
          )}

          {canUpload && item.versoes.length > 0 && visual.label !== 'Rejeitado' && (
            <Button type="button" size="sm" variant="outline" onClick={() => { setShowUpload((current) => !current); setExpanded(true) }}>
              <Upload size={13} />
              Enviar nova versão
            </Button>
          )}

          {mode === 'gestor' && latest && (
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => setExpanded(true)} title="Mais detalhes">
              <MoreVertical size={14} />
            </Button>
          )}

          <Button type="button" size="icon-sm" variant="ghost" onClick={() => setExpanded((current) => !current)} title={expanded ? 'Recolher' : 'Expandir'}>
            <ExpandedIcon size={15} />
          </Button>
        </div>
      </div>

      {(expanded || shouldShowUpload) && (
        <div className="border-t border-border px-3 py-3">
          <div className="space-y-3 rounded-lg bg-muted/25 p-3">
            {item.descricao && <p className="text-sm text-muted-foreground">{item.descricao}</p>}

            {showPrazo && (
              <div className="grid gap-3 rounded-lg border bg-card p-3 text-sm md:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Marco do prazo</p>
                  <p className="font-medium text-foreground">{item.marcoPrazo === 'desembolso' ? 'Desembolso' : item.marcoPrazo}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Data limite</p>
                  <p className="font-medium text-foreground">{formatDateBR(item.dataLimite)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Situação do prazo</p>
                  <p className={`font-medium ${item.statusPrazo === 'vencido' ? 'text-destructive' : 'text-foreground'}`}>{item.prazoDetalhe}</p>
                </div>
              </div>
            )}

            {mode === 'gestor' && item.versoes.length === 0 && (
              <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
                Documento ainda não enviado pelo cedente. Impacto: {item.bloqueiaFluxo ? 'bloqueia a conclusão logística.' : 'não bloqueia o fluxo.'}
              </div>
            )}

            {item.erroNfsCompartilhamento && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/35 bg-warning/10 p-3 text-sm text-warning-foreground">
                <AlertTriangle className="mt-0.5 shrink-0" size={15} />
                <span>{item.erroNfsCompartilhamento} O checklist e o envio individual continuam disponiveis.</span>
              </div>
            )}

            {mode === 'cedente' && item.envioAntecipado && item.familiaDocumental === 'cte' && item.nfsCompartilhamento.length > 1 && (
              <fieldset className="rounded-lg border bg-background p-3">
                <legend className="px-1 text-sm font-medium text-foreground">Notas fiscais vinculadas ao CT-e</legend>
                <p className="mb-2 text-xs text-muted-foreground">Selecione todas as NFs deste contexto que constam no mesmo CT-e. A NF atual permanece obrigatoria.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {item.nfsCompartilhamento.map((nf) => {
                    const current = nf.id === notaFiscalId
                    const checked = current || selectedNfIds.includes(nf.id)
                    return (
                      <label key={nf.id} className="flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={current}
                          onChange={(event) => setSelectedNfIds((ids) => event.target.checked
                            ? Array.from(new Set([...ids, nf.id]))
                            : ids.filter((id) => id !== nf.id))}
                        />
                        <span className="truncate" title={nf.chaveAcesso || undefined}>NF {nf.numero}</span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>
            )}

            {shouldShowUpload && (
              <DocumentDropzone
                accept={accept}
                sending={sending === item.id}
                label={item.versoes.length ? 'Selecione o arquivo da nova versão' : 'Arraste o arquivo aqui ou clique para selecionar'}
                onUpload={async (file) => {
                  await onUpload(item, file, selectedNfIds)
                  setShowUpload(false)
                }}
              />
            )}

            {mode === 'cedente' && !item.uploadPermitido && <p className="text-xs text-muted-foreground">Tipo ainda não catalogado para upload nesta fase.</p>}

            {item.versoes.length > 0 && (
              <div className="divide-y divide-border rounded-lg border bg-card">
                {item.versoes.map((version) => (
                  <div key={version.id} className="flex flex-col gap-2 px-3 py-2.5 text-xs lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">v{version.numero} · {version.nome}</p>
                      <p className="text-muted-foreground">
                        {labels[version.status] || version.status} · enviado por {version.enviadoPorNome || 'não informado'} em {formatDateBR(version.enviadoEm)}
                      </p>
                      {version.ultimaAnalise && (
                        <p className="text-muted-foreground">
                          Analisado por {version.ultimaAnalise.analisadoPorNome || 'não informado'} em {formatDateBR(version.ultimaAnalise.analisadoEm)}
                        </p>
                      )}
                      {version.ultimaAnalise?.observacoes && <p className="mt-1 text-destructive">{version.ultimaAnalise.observacoes}</p>}
                      {mode === 'gestor' && <TechnicalDetails version={version} />}
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => onDownload(version.id)}>
                      <Eye size={13} />
                      Ver
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  )
}

function OperationalSummary({ checklist }: { checklist: ChecklistDocumento }) {
  const resumo = checklist.resumoOperacional
  const prazo = resumo.proximoPrazo
  return (
    <section className="mb-4 rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Resumo operacional</p>
          <h2 className="mt-1 text-lg font-semibold">Situação documental e logística</h2>
        </div>
        <span className={`inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${logisticalTone(resumo.statusLogistico)}`}>
          <Truck size={13} />
          {logisticoLabels[resumo.statusLogistico]}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <div className="rounded-lg border bg-background px-3 py-2.5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Antecipação</p>
          <p className="mt-1 font-semibold">{labels[resumo.statusAntecipacao] || resumo.statusAntecipacao}</p>
        </div>
        <div className="rounded-lg border bg-background px-3 py-2.5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Pré-cessão</p>
          <p className="mt-1 font-semibold">{resumo.pendenciasPreCessao === 0 ? 'Sem pendências' : `${resumo.pendenciasPreCessao} pendência(s)`}</p>
        </div>
        <div className="rounded-lg border bg-background px-3 py-2.5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Pós-cessão</p>
          <p className="mt-1 font-semibold">{resumo.pendenciasPosCessao === 0 ? 'Sem pendências' : `${resumo.pendenciasPosCessao} pendência(s)`}</p>
        </div>
      </div>
      {prazo && (
        <div className={`mt-3 flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm md:flex-row md:items-center md:justify-between ${prazo.statusPrazo === 'vencido' ? 'border-destructive/30 bg-destructive/5' : 'bg-background'}`}>
          <div className="flex items-center gap-2">
            {prazo.statusPrazo === 'vencido' ? <AlertTriangle size={16} className="text-destructive" /> : <Clock size={16} className="text-muted-foreground" />}
            <span className="font-medium">Prazo mais próximo: {prazo.nome}</span>
          </div>
          <span className="text-muted-foreground">{prazo.dataLimite ? formatDateBR(prazo.dataLimite) : 'Sem data'} · {prazo.prazoDetalhe || 'não iniciado'}</span>
        </div>
      )}
    </section>
  )
}

function CanhotoPostponementCard({
  notaFiscalId,
  mode,
  data,
  onSaved,
}: {
  notaFiscalId: string
  mode: ChecklistMode
  data: NonNullable<ChecklistDocumento['postergacaoCanhoto']>
  onSaved: () => Promise<void>
}) {
  const notifications = useNotifications()
  const [open, setOpen] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [novaPrevisao, setNovaPrevisao] = useState('')
  const [motivo, setMotivo] = useState('')

  const reset = () => {
    setReviewing(false)
    setNovaPrevisao('')
    setMotivo('')
  }

  const review = () => {
    if (!data.avaliacao.dataMinima || !data.avaliacao.dataMaxima) return
    const error = validarNovaPrevisaoCanhoto({
      novaPrevisao,
      prazoOriginal: data.prazoOriginal,
      hoje: data.dataReferencia,
      dataMinima: data.avaliacao.dataMinima,
      dataMaxima: data.avaliacao.dataMaxima,
    })
    if (error) return notifications.warning(error)
    if (!motivo.trim()) return notifications.warning('Informe o motivo da nova previsão.')
    setReviewing(true)
  }

  const submit = async () => {
    setSubmitting(true)
    const result = await comunicarPostergacaoUploadCanhoto({ notaFiscalId, novaPrevisao, motivo })
    notifications.fromActionResult(result)
    if (result.success) {
      await onSaved()
      setOpen(false)
      reset()
    }
    setSubmitting(false)
  }

  const statusTone = (status: StatusPrazoUploadCanhoto | null) => status === 'vencido' || status === 'atendido_em_atraso'
    ? 'text-destructive'
    : status === 'atendido_no_prazo'
      ? 'text-success-foreground'
      : 'text-foreground'

  return (
    <div className="mb-3 rounded-xl border bg-background p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info/15 text-info-foreground">
            <CalendarClock size={17} />
          </span>
          <div>
            <p className="font-semibold">Previsão de upload do canhoto</p>
            <p className="text-sm text-muted-foreground">O prazo original permanece preservado para acompanhamento de atraso.</p>
          </div>
        </div>
        {mode === 'cedente' && data.avaliacao.permitida && (
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            <CalendarClock size={14} />
            Informar nova previsão de upload
          </Button>
        )}
      </div>

      <div className="mt-3 grid gap-3 rounded-lg border bg-card p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Prazo original</p>
          <p className="font-medium">{formatDateBR(data.prazoOriginal)}</p>
          <p className={`text-xs ${statusTone(data.statusPrazoOriginal)}`}>{prazoCanhotoLabels[data.statusPrazoOriginal]}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Nova previsão</p>
          <p className="font-medium">{formatDateBR(data.novaPrevisao) || 'Não informada'}</p>
          {data.statusNovaPrevisao && <p className={`text-xs ${statusTone(data.statusNovaPrevisao)}`}>{prazoCanhotoLabels[data.statusNovaPrevisao]}</p>}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Primeiro upload</p>
          <p className="font-medium">{formatDateBR(data.primeiroUploadEm) || 'Ainda não realizado'}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Comunicação</p>
          <p className="font-medium">{formatDateBR(data.comunicadaEm) || 'Não utilizada'}</p>
          {mode === 'gestor' && data.comunicadaPorNome && <p className="truncate text-xs text-muted-foreground" title={data.comunicadaPorNome}>{data.comunicadaPorNome}</p>}
        </div>
      </div>

      {data.motivo && (
        <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">Motivo informado: </span>{data.motivo}
        </div>
      )}
      {mode === 'gestor' && data.limiteDiasAplicado && (
        <p className="mt-2 text-xs text-muted-foreground">Limite aplicado pelo snapshot: {data.limiteDiasAplicado} dias corridos. A comunicação não exige aprovação.</p>
      )}

      <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) reset() }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{reviewing ? 'Confirmar nova previsão' : 'Informar nova previsão de upload'}</DialogTitle>
            <DialogDescription>
              Esta comunicação pode ser feita uma única vez e não altera o prazo original do canhoto.
            </DialogDescription>
          </DialogHeader>

          {!reviewing ? (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">
                <div><p className="text-xs uppercase text-muted-foreground">Prazo original</p><p className="font-medium">{formatDateBR(data.prazoOriginal)}</p></div>
                <div><p className="text-xs uppercase text-muted-foreground">Data máxima</p><p className="font-medium">{formatDateBR(data.avaliacao.dataMaxima)}</p></div>
              </div>
              <div>
                <Label htmlFor="nova-previsao-canhoto">Nova previsão</Label>
                <Input
                  id="nova-previsao-canhoto"
                  type="date"
                  min={data.avaliacao.dataMinima || undefined}
                  max={data.avaliacao.dataMaxima || undefined}
                  value={novaPrevisao}
                  onChange={(event) => setNovaPrevisao(event.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">Intervalo permitido: {formatDateBR(data.avaliacao.dataMinima)} a {formatDateBR(data.avaliacao.dataMaxima)}.</p>
              </div>
              <div>
                <Label htmlFor="motivo-postergacao-canhoto">Motivo</Label>
                <textarea
                  id="motivo-postergacao-canhoto"
                  value={motivo}
                  maxLength={1000}
                  onChange={(event) => setMotivo(event.target.value)}
                  className="mt-2 min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Explique por que o upload será realizado em uma nova data."
                />
              </div>
              <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
                Depois de confirmada, a nova previsão não poderá ser editada ou informada novamente. O primeiro upload do canhoto também encerra definitivamente essa opção.
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
              <div><p className="text-xs uppercase text-muted-foreground">Nova previsão</p><p className="font-semibold">{formatDateBR(novaPrevisao)}</p></div>
              <div><p className="text-xs uppercase text-muted-foreground">Motivo</p><p>{motivo.trim()}</p></div>
              <p className="font-medium text-warning-foreground">Confirme somente se os dados estiverem corretos. Esta ação é irreversível.</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => reviewing ? setReviewing(false) : setOpen(false)} disabled={submitting}>
              {reviewing ? 'Voltar' : 'Cancelar'}
            </Button>
            {reviewing ? (
              <Button type="button" onClick={submit} disabled={submitting}>
                {submitting && <Loader2 size={14} className="animate-spin" />}
                Confirmar comunicação
              </Button>
            ) : (
              <Button type="button" onClick={review} disabled={!novaPrevisao || !motivo.trim()}>Revisar comunicação</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export type ChecklistEligibilitySummary = Pick<
  ChecklistDocumento['elegibilidade'],
  'elegivel' | 'requisitosPendentes' | 'totalObrigatorios' | 'concluidosObrigatorios' | 'pendentesObrigatorios'
>

export function ChecklistCedente({
  notaFiscalId,
  mode = 'cedente',
  onEligibilityChange,
}: {
  notaFiscalId: string
  mode?: ChecklistMode
  onEligibilityChange?: (eligibility: ChecklistEligibilitySummary) => void
}) {
  const notifications = useNotifications()
  const [checklist, setChecklist] = useState<ChecklistDocumento | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const nextChecklist = await listarChecklistDaNota(notaFiscalId)
      setChecklist(nextChecklist)
      onEligibilityChange?.({
        elegivel: nextChecklist.elegibilidade.elegivel,
        requisitosPendentes: nextChecklist.elegibilidade.requisitosPendentes,
        totalObrigatorios: nextChecklist.elegibilidade.totalObrigatorios,
        concluidosObrigatorios: nextChecklist.elegibilidade.concluidosObrigatorios,
        pendentesObrigatorios: nextChecklist.elegibilidade.pendentesObrigatorios,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível carregar o checklist.'
      notifications.error(message, { dedupeKey: `checklist:${notaFiscalId}:${message}` })
    } finally {
      setLoading(false)
    }
  }, [notaFiscalId, notifications, onEligibilityChange])

  useEffect(() => { void load() }, [load])

  const upload = async (item: ChecklistDocumentoItem, file: File, notaFiscalIds?: string[]) => {
    setSending(item.id)
    const form = new FormData()
    form.set('notaFiscalId', notaFiscalId)
    form.set('requisitoId', item.envioAntecipado ? item.politicaRequisitoId : item.id)
    if (item.envioAntecipado) {
      form.set('envioAntecipado', 'true')
      form.set('notaFiscalIds', Array.from(new Set([notaFiscalId, ...(notaFiscalIds || [])])).join(','))
    }
    if (item.entregaId) form.set('entregaId', item.entregaId)
    form.set('arquivo', file)
    const result = await enviarDocumentoDaNota(form)
    notifications.fromActionResult(result)
    if (result.success) await load()
    setSending(null)
  }

  const download = async (versionId: string) => {
    const result = await baixarVersaoDocumento(versionId)
    if (!result.success || !result.url) {
      notifications.fromActionResult(result, 'Não foi possível abrir o documento.')
      return
    }
    window.open(result.url, '_blank', 'noopener,noreferrer')
  }

  const analyze = async (versionId: string, result: 'aprovado' | 'rejeitado' | 'requer_ajuste') => {
    const observation = result === 'aprovado' ? undefined : window.prompt('Informe o motivo da rejeição/ajuste:') || ''
    if (result !== 'aprovado' && !(observation || '').trim()) return
    setProcessing(versionId)
    const response = await analisarVersaoDocumento(versionId, result, observation || undefined)
    if (response.success) notifications.success('Análise registrada.')
    else notifications.fromActionResult(response, 'Falha na análise.')
    if (response.success) await load()
    setProcessing(null)
  }

  const posBadge = useMemo(() => {
    if (!checklist?.posCessaoResumo.existe) return null
    const status = checklist.posCessaoResumo.status
    return {
      label: resumoPosLabels[status] || status,
      tone: status === 'concluido'
        ? 'bg-success/15 text-success-foreground'
        : status === 'vencido'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-warning/15 text-warning-foreground',
    }
  }, [checklist])

  if (loading) return <div className="rounded-xl border p-4 text-sm text-muted-foreground">Carregando checklist documental...</div>
  if (!checklist) return null

  if (checklist.estadoChecklist.estado === 'nao_aplicavel') return null

  if (checklist.estadoChecklist.estado === 'sem_politica' || checklist.estadoChecklist.estado === 'nao_instanciado') {
    if (mode === 'cedente') return null
    return (
      <section className="mb-4 rounded-xl border bg-card p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning-foreground">
            <AlertTriangle size={17} />
          </span>
          <div>
            <h2 className="font-semibold">
              {checklist.estadoChecklist.estado === 'nao_instanciado' ? 'Requisitos documentais pendentes de geração' : 'Política documental não configurada'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {checklist.estadoChecklist.mensagemGestor}
            </p>
          </div>
        </div>
      </section>
    )
  }

  if (checklist.items.length === 0) return null

  return (
    <div className="mb-4 space-y-4">
      {mode === 'gestor' && <OperationalSummary checklist={checklist} />}
      {mode === 'gestor' && checklist.resumoOperacional.statusAntecipacao === 'rascunho' && (
        <div className="rounded-lg border border-info/30 bg-info/10 px-3 py-2.5 text-sm text-info-foreground">
          A NF ainda não foi submetida pelo cedente. Os documentos podem ser consultados e analisados, mas a análise formal da NF ainda não foi iniciada.
        </div>
      )}

      <section className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Documentos pré-cessão</h2>
            <p className="text-sm text-muted-foreground">
              {mode === 'gestor' ? 'Análise por versão antes da cessão.' : 'Cada documento é analisado por versão antes da cessão.'}
            </p>
          </div>
          <span className={`rounded-full px-2 py-1 text-xs font-medium ${checklist.elegibilidade.elegivel ? 'bg-success/15 text-success-foreground' : 'bg-warning/15 text-warning-foreground'}`}>
            {checklist.elegibilidade.elegivel
              ? mode === 'cedente' ? 'Pronta para submissão' : 'Documentos obrigatórios presentes'
              : 'Pendências documentais'}
          </span>
        </div>
        {mode === 'cedente' && checklist.elegibilidade.elegivel && checklist.preCessao.length > 0 && (
          <p className="mb-3 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success-foreground">
            Todos os documentos obrigatórios desta etapa foram enviados. A nota pode ser submetida para análise.
          </p>
        )}
        {checklist.preCessao.length === 0 ? (
          <p className="text-sm text-muted-foreground">Não há requisitos pré-cessão configurados para esta NF.</p>
        ) : (
          <div className="space-y-2">
            {checklist.preCessao.map((item) => (
              <RequirementCard key={item.id} item={item} notaFiscalId={notaFiscalId} mode={mode} sending={sending} processing={processing} onUpload={upload} onDownload={download} onAnalyze={analyze} />
            ))}
            <ParcelasBoletosNota notaFiscalId={notaFiscalId} mode={mode} />
          </div>
        )}
      </section>

      {checklist.logisticaAntecipada.length > 0 && (
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-semibold">Envio antecipado de documentos logisticos</h2>
              <p className="text-sm text-muted-foreground">
                {checklist.gateLogisticoPreCessao.exigido
                  ? 'A politica exige uma evidencia logistica aprovada antes da cessao.'
                  : 'Envio antecipado — opcional nesta etapa. O requisito oficial continua sendo pos-cessao.'}
              </p>
            </div>
            <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${checklist.gateLogisticoPreCessao.status === 'INDETERMINADA' ? 'bg-warning/15 text-warning-foreground' : 'bg-info/15 text-info-foreground'}`}>
              <Truck size={13} />
              {checklist.gateLogisticoPreCessao.status === 'ENTREGUE'
                ? 'Entrega comprovada'
                : checklist.gateLogisticoPreCessao.status === 'EM_TRANSITO'
                  ? 'Em transito'
                  : 'Situacao nao determinada'}
            </span>
          </div>
          <div className="space-y-2">
            {checklist.logisticaAntecipada.map((item) => (
              <RequirementCard key={item.id} item={item} notaFiscalId={notaFiscalId} mode={mode} sending={sending} processing={processing} onUpload={upload} onDownload={download} onAnalyze={analyze} />
            ))}
          </div>
        </section>
      )}

      {(checklist.posCessao.length > 0 || checklist.entrega || mode === 'gestor') && (
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-semibold">Documentos pós-cessão</h2>
              <p className="text-sm text-muted-foreground">
                Requisitos liberados após o desembolso para acompanhamento logístico da NF.
              </p>
            </div>
            {posBadge && <span className={`w-fit rounded-full px-2 py-1 text-xs font-medium ${posBadge.tone}`}>{posBadge.label}</span>}
          </div>
          {checklist.entrega && (
            <div className="mb-3 rounded-lg border bg-background px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${logisticalTone(checklist.resumoOperacional.statusLogistico)}`}>
                  <Truck size={13} />
                  {logisticoLabels[checklist.resumoOperacional.statusLogistico]}
                </span>
                {checklist.entrega.motivoPendencia && <span className="text-destructive">{checklist.entrega.motivoPendencia}</span>}
              </div>
            </div>
          )}
          {checklist.postergacaoCanhoto && (
            <CanhotoPostponementCard
              notaFiscalId={notaFiscalId}
              mode={mode}
              data={checklist.postergacaoCanhoto}
              onSaved={load}
            />
          )}
          {checklist.posCessao.length === 0 ? (
            <p className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">Os documentos pós-cessão serão liberados após o desembolso.</p>
          ) : (
            <div className="space-y-2">
              {checklist.posCessao.map((item) => (
                <RequirementCard key={item.id} item={item} notaFiscalId={notaFiscalId} mode={mode} sending={sending} processing={processing} onUpload={upload} onDownload={download} onAnalyze={analyze} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

export function ChecklistDocumentalNota(props: { notaFiscalId: string; mode?: ChecklistMode }) {
  return <ChecklistCedente {...props} />
}
