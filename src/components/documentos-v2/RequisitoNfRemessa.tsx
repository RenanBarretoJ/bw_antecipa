'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle, Clock, FileText, ShieldAlert, Truck, Upload, XCircle } from 'lucide-react'
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

/**
 * Componente especializado do requisito `nf_remessa` dentro de Requisitos
 * Documentais (ticket de consolidacao da UI). Substitui inteiramente o
 * fluxo generico de upload/`documentos_v2` para este tipo -- nunca mostra
 * "Tipo ainda nao catalogado para upload nesta fase.", nunca usa
 * DocumentDropzone generico. O envio continua exclusivamente via
 * registrar_nota_fiscal_remessa (nota_fiscal_remessas), o mesmo backend do
 * extinto card `RemessaDaNota`, agora consolidado aqui.
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
  const inputRef = useRef<HTMLInputElement>(null)

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
    if (inputRef.current) inputRef.current.value = ''
  }

  const abrirArquivo = async (remessaId: string) => {
    const result = await obterUrlNotaFiscalRemessa(notaFiscalId, remessaId)
    if (!result.success || !result.data?.url) return notifications.error(result.details || result.message)
    window.open(result.data.url, '_blank', 'noopener,noreferrer')
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
  const rotuloEnvio = remessas.length === 0 ? 'Enviar NF de remessa (XML)' : 'Enviar outra remessa'
  const remessaDestacada = remessas.find((remessa) => remessa.status_validacao === 'VALIDADA') || remessas[0] || null

  return (
    <article className="rounded-xl border bg-background">
      <div className="flex flex-col gap-2 px-3 py-2.5 md:min-h-16 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Truck size={17} /></span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold text-foreground">{item.nome}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${item.obrigatorio ? 'bg-warning/15 text-warning-foreground' : 'bg-muted text-muted-foreground'}`}>
                {item.obrigatorio ? 'Obrigatório' : 'Opcional'}
              </span>
              {item.bloqueiaFluxo && mode === 'gestor' && statusVisual !== 'validada' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                  <ShieldAlert size={11} /> Bloqueia
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {remessaDestacada
                ? `NF ${remessaDestacada.numero || remessaDestacada.chave_acesso}${remessaDestacada.serie ? ` • Série ${remessaDestacada.serie}` : ''}${remessaDestacada.emitente_razao_social ? ` • ${remessaDestacada.emitente_razao_social}` : ''}`
                : 'Documento auxiliar/logístico. Nunca gera parcela, título ou exposição.'}
            </span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${visual.tone}`}>
            <StatusIcon size={13} />
            {visual.label}
          </span>
          {podeEnviar && (
            <>
              <input
                ref={inputRef}
                type="file"
                accept=".xml,application/xml,text/xml"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void enviarArquivo(file)
                }}
              />
              <Button type="button" size="sm" variant="outline" disabled={enviando} onClick={() => inputRef.current?.click()}>
                <Upload size={13} />
                {enviando ? 'Enviando...' : rotuloEnvio}
              </Button>
            </>
          )}
        </div>
      </div>

      {remessas.length > 0 && (
        <div className="divide-y divide-border border-t border-border">
          {remessas.map((remessa) => {
            const remessaVisual = VISUAL_POR_STATUS[resolverStatusVisualNfRemessa({ obrigatorio: item.obrigatorio, remessas: [remessa] })]
            return (
              <div key={remessa.id} className="flex flex-col gap-2 px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    <FileText size={13} className="text-muted-foreground" />
                    NF {remessa.numero || '—'}{remessa.serie ? ` • Série ${remessa.serie}` : ''}{remessa.emitente_razao_social ? ` • ${remessa.emitente_razao_social}` : ''}
                  </span>
                  <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${remessaVisual.tone}`}>{remessaVisual.label}</span>
                </div>
                <p className="font-mono text-xs text-muted-foreground">{remessa.chave_acesso}</p>
                <div className="grid grid-cols-1 gap-2 text-muted-foreground md:grid-cols-2">
                  <span>Emitente: {remessa.emitente_razao_social || '—'} ({formatCnpj(remessa.emitente_cnpj)})</span>
                  <span>Destinatário: {remessa.destinatario_razao_social || '—'} ({formatCnpj(remessa.destinatario_cnpj)})</span>
                  <span>Emissão: {remessa.data_emissao ? formatDate(remessa.data_emissao) : '—'}</span>
                  <span className="font-medium text-foreground">Valor: {formatCurrency(remessa.valor_total)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {remessa.referencia_nf_venda_confirmada
                    ? 'Vínculo confirmado com esta NF de venda (NFref).'
                    : 'Sem referência estruturada (NFref) a esta NF de venda.'}
                </p>
                {remessa.motivos_validacao.length > 0 && (
                  <ul className="list-inside list-disc text-xs text-muted-foreground">
                    {remessa.motivos_validacao.map((motivo, index) => <li key={index}>{motivo}</li>)}
                  </ul>
                )}
                <div>
                  <button type="button" className="text-xs font-medium text-primary underline-offset-2 hover:underline" onClick={() => abrirArquivo(remessa.id)}>
                    Ver XML
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </article>
  )
}
