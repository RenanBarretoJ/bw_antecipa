'use client'

import { useEffect, useState } from 'react'
import { CheckCircle, ChevronDown, ChevronUp, Clock, Copy, Eye, FileText, ShieldAlert, Truck, XCircle } from 'lucide-react'
import {
  enviarNotaFiscalRemessa,
  listarRemessasDaNota,
  obterUrlNotaFiscalRemessa,
  type RemessaDaNotaRegistro,
} from '@/lib/actions/nota-fiscal-remessa'
import { resolverStatusVisualNfRemessa, type StatusVisualNfRemessa } from '@/lib/documentos-v2/nf-remessa-status-visual'
import type { ChecklistDocumentoItem } from '@/lib/actions/documento-v2'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { DocumentDropzone } from '@/components/documentos-v2/DocumentDropzone'
import { formatCurrency, formatDate } from '@/lib/utils'

type ChecklistMode = 'cedente' | 'gestor'

const VISUAL_POR_STATUS: Record<StatusVisualNfRemessa, { label: string; tone: string; icon: typeof CheckCircle }> = {
  nao_enviada: { label: 'Não enviada', tone: 'text-muted-foreground bg-muted', icon: Clock },
  pendente: { label: 'Pendente', tone: 'text-warning-foreground bg-warning/15', icon: Clock },
  validada: { label: 'Validada', tone: 'text-success-foreground bg-success/15', icon: CheckCircle },
  em_revisao: { label: 'Em revisão', tone: 'text-info-foreground bg-info/15', icon: Clock },
  rejeitada: { label: 'Rejeitada', tone: 'text-destructive bg-destructive/10', icon: XCircle },
}

function formatCnpj(cnpj: string | null): string {
  if (!cnpj || cnpj.length !== 14) return cnpj || '—'
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`
}

export function truncarChaveAcesso(chave: string): string {
  if (chave.length <= 16) return chave
  return `${chave.slice(0, 8)}…${chave.slice(-8)}`
}

/**
 * Componente especializado do requisito `nf_remessa` dentro de Requisitos
 * Documentais. Substitui inteiramente o fluxo generico de upload/`documentos_v2`
 * para este tipo -- nunca mostra "Tipo ainda nao catalogado para upload nesta
 * fase.", nunca usa a rota generica de envio. O envio continua exclusivamente
 * via registrar_nota_fiscal_remessa (nota_fiscal_remessas). O cabecalho e o
 * padrao de expandir/recolher seguem o mesmo visual do RequirementCardGeneric
 * para manter consistencia entre os requisitos do checklist.
 */
export function RequisitoNfRemessa({
  item,
  notaFiscalId,
  mode,
}: {
  item: ChecklistDocumentoItem
  notaFiscalId: string
  mode: ChecklistMode
}) {
  const notifications = useNotifications()
  const [remessas, setRemessas] = useState<RemessaDaNotaRegistro[] | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const load = async () => {
    const result = await listarRemessasDaNota(notaFiscalId)
    if (!result.success || !result.data) {
      if (!result.success) notifications.error(result.message)
      setRemessas([])
      return
    }
    setRemessas(result.data)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notaFiscalId])

  const enviarArquivo = async (arquivo: File) => {
    setEnviando(true)
    const formData = new FormData()
    formData.set('arquivo', arquivo)
    const result = await enviarNotaFiscalRemessa(notaFiscalId, formData)
    notifications.fromActionResult(result)
    if (result.success) await load()
    setEnviando(false)
  }

  const abrirArquivo = async (remessaId: string) => {
    const result = await obterUrlNotaFiscalRemessa(notaFiscalId, remessaId)
    if (!result.success || !result.data?.url) return notifications.error(result.details || result.message)
    window.open(result.data.url, '_blank', 'noopener,noreferrer')
  }

  const copiarChave = async (chave: string) => {
    try {
      await navigator.clipboard.writeText(chave)
      notifications.success('Chave de acesso copiada.')
    } catch {
      notifications.error('Não foi possível copiar a chave de acesso.')
    }
  }

  if (remessas === null) {
    return (
      <article className="rounded-xl border bg-background">
        <div className="flex items-center gap-3 px-3 py-2.5 md:min-h-16">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Truck size={17} /></span>
          <span className="text-sm text-muted-foreground">Carregando NF de Remessa...</span>
        </div>
      </article>
    )
  }

  const statusVisual = resolverStatusVisualNfRemessa({ obrigatorio: item.obrigatorio, remessas })
  const visual = VISUAL_POR_STATUS[statusVisual]
  const StatusIcon = visual.icon
  const podeEnviar = mode === 'cedente' || mode === 'gestor'
  const remessaDestacada = remessas.find((remessa) => remessa.status_validacao === 'VALIDADA') || remessas[0] || null
  const resumo = remessas.length === 0
    ? 'Nenhuma NF de remessa enviada.'
    : `${remessas.length} ${remessas.length > 1 ? 'remessas enviadas' : 'remessa enviada'}${remessaDestacada ? ` • NF ${remessaDestacada.numero || remessaDestacada.chave_acesso}` : ''}`
  const shouldShowBody = expanded || remessas.length === 0
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
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Truck size={17} /></span>
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
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{resumo}</span>
          </span>
        </button>

        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${visual.tone}`}>
            <StatusIcon size={13} />
            {visual.label}
          </span>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => setExpanded((current) => !current)} title={expanded ? 'Recolher' : 'Expandir'}>
            <ExpandedIcon size={15} />
          </Button>
        </div>
      </div>

      {shouldShowBody && (
        <div className="border-t border-border px-3 py-3">
          <div className="space-y-3 rounded-lg bg-muted/25 p-3">
            {item.descricao && <p className="text-sm text-muted-foreground">{item.descricao}</p>}

            {mode === 'gestor' && remessas.length === 0 && (
              <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
                Documento ainda não enviado pelo cedente. Impacto: {item.bloqueiaFluxo ? 'bloqueia a conclusão logística.' : 'não bloqueia o fluxo.'}
              </div>
            )}

            {remessas.length > 0 && (
              <div className="divide-y divide-border rounded-lg border bg-card">
                {remessas.map((remessa) => {
                  const remessaVisual = VISUAL_POR_STATUS[resolverStatusVisualNfRemessa({ obrigatorio: item.obrigatorio, remessas: [remessa] })]
                  return (
                    <div key={remessa.id} className="flex flex-col gap-2 px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                          <FileText size={13} className="shrink-0 text-muted-foreground" />
                          <span className="truncate">NF {remessa.numero || '—'}{remessa.serie ? ` • Série ${remessa.serie}` : ''}</span>
                        </span>
                        <span className={`inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${remessaVisual.tone}`}>{remessaVisual.label}</span>
                      </div>
                      {remessa.emitente_razao_social && (
                        <p className="truncate text-xs text-muted-foreground">{remessa.emitente_razao_social}</p>
                      )}
                      <div className="grid grid-cols-1 gap-1.5 text-xs text-muted-foreground md:grid-cols-2">
                        <span>Emitente: {remessa.emitente_razao_social || '—'} ({formatCnpj(remessa.emitente_cnpj)})</span>
                        <span>Destinatário: {remessa.destinatario_razao_social || '—'} ({formatCnpj(remessa.destinatario_cnpj)})</span>
                        <span>Data de emissão: {remessa.data_emissao ? formatDate(remessa.data_emissao) : '—'}</span>
                        <span className="font-medium text-foreground">Valor: {formatCurrency(remessa.valor_total)}</span>
                        {remessa.quantidade_total !== null && (
                          <span>Quantidade: {remessa.quantidade_total}{remessa.unidade_quantidade ? ` ${remessa.unidade_quantidade}` : ''}</span>
                        )}
                        <span>
                          {remessa.referencia_nf_venda_confirmada
                            ? 'Vínculo com a NF de venda confirmado.'
                            : 'Sem vínculo estruturado com a NF de venda.'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <span className="font-mono text-muted-foreground" title={remessa.chave_acesso}>{truncarChaveAcesso(remessa.chave_acesso)}</span>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                          onClick={() => copiarChave(remessa.chave_acesso)}
                        >
                          <Copy size={12} /> Copiar chave
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                          onClick={() => abrirArquivo(remessa.id)}
                        >
                          <Eye size={12} /> Ver XML
                        </button>
                      </div>
                      {remessa.motivos_validacao.length > 0 && (
                        <ul className="list-inside list-disc text-xs text-muted-foreground">
                          {remessa.motivos_validacao.map((motivo, index) => <li key={index}>{motivo}</li>)}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {podeEnviar && (
              <DocumentDropzone
                accept=".xml,application/xml,text/xml"
                sending={enviando}
                label={remessas.length === 0 ? 'Arraste o arquivo aqui ou clique para selecionar' : 'Enviar outra NF de Remessa (XML)'}
                onUpload={enviarArquivo}
              />
            )}
          </div>
        </div>
      )}
    </article>
  )
}
