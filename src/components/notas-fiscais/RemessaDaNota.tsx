'use client'

import { useEffect, useRef, useState } from 'react'
import { Truck } from 'lucide-react'
import {
  enviarNotaFiscalRemessa,
  listarRemessasDaNota,
  obterUrlNotaFiscalRemessa,
  type RemessaDaNotaRegistro,
} from '@/lib/actions/nota-fiscal-remessa'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatDate } from '@/lib/utils'

type Mode = 'cedente' | 'gestor'

const STATUS_LABEL: Record<RemessaDaNotaRegistro['status_validacao'], string> = {
  VALIDADA: 'Validada',
  REVISAO_MANUAL: 'Revisao manual',
  REJEITADA: 'Rejeitada',
}

const STATUS_VARIANT: Record<RemessaDaNotaRegistro['status_validacao'], 'default' | 'secondary' | 'destructive'> = {
  VALIDADA: 'default',
  REVISAO_MANUAL: 'secondary',
  REJEITADA: 'destructive',
}

function formatCnpj(cnpj: string | null): string {
  if (!cnpj || cnpj.length !== 14) return cnpj || '—'
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`
}

/**
 * Card "NF de Remessa - Opcional" (ticket NF de Remessa como lastro
 * logistico auxiliar). A NF de venda continua sendo o unico ativo
 * financeiro -- este card e puramente documental/logistico e nunca altera
 * parcelas, VP, taxa, operacao ou exposicao. Ausencia de remessa nunca
 * bloqueia a venda; por isso o card sempre renderiza (mesmo vazio), com uma
 * acao de envio para quem pode enviar.
 */
export function RemessaDaNota({
  notaFiscalVendaId,
  mode,
  editable,
}: {
  notaFiscalVendaId: string
  mode: Mode
  /** Permite enviar uma nova remessa (cedente com a NF ainda editavel, ou gestor). */
  editable: boolean
}) {
  const notifications = useNotifications()
  const [remessas, setRemessas] = useState<RemessaDaNotaRegistro[] | null>(null)
  const [enviando, setEnviando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    const result = await listarRemessasDaNota(notaFiscalVendaId)
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
  }, [notaFiscalVendaId])

  const podeEnviar = editable && (mode === 'cedente' || mode === 'gestor')

  if (remessas === null) return null
  if (remessas.length === 0 && !podeEnviar) return null

  const enviarArquivo = async (arquivo: File) => {
    setEnviando(true)
    const formData = new FormData()
    formData.set('arquivo', arquivo)
    const result = await enviarNotaFiscalRemessa(notaFiscalVendaId, formData)
    notifications.fromActionResult(result)
    if (result.success) await load()
    setEnviando(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const abrirArquivo = async (remessaId: string) => {
    const result = await obterUrlNotaFiscalRemessa(notaFiscalVendaId, remessaId)
    if (!result.success || !result.data?.url) return notifications.error(result.details || result.message)
    window.open(result.data.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <article className="rounded-xl border bg-background">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Truck size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">NF de Remessa — Opcional</p>
          <p className="text-xs text-muted-foreground">
            {remessas.length === 0
              ? 'Nenhuma NF de remessa vinculada. Documento auxiliar, nao altera a venda.'
              : `${remessas.length} remessa(s) vinculada(s)`}
          </p>
        </div>
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
              {enviando ? 'Enviando...' : 'Enviar NF de remessa (XML)'}
            </Button>
          </>
        )}
      </div>

      {remessas.length > 0 && (
        <div className="divide-y divide-border border-t border-border">
          {remessas.map((remessa) => (
            <div key={remessa.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  NF {remessa.numero || '—'}{remessa.serie ? `/${remessa.serie}` : ''}
                </span>
                <Badge variant={STATUS_VARIANT[remessa.status_validacao]}>{STATUS_LABEL[remessa.status_validacao]}</Badge>
              </div>
              <p className="font-mono text-xs text-muted-foreground">{remessa.chave_acesso}</p>
              <div className="grid grid-cols-1 gap-2 text-muted-foreground md:grid-cols-2">
                <span>Emitente: {remessa.emitente_razao_social || '—'} ({formatCnpj(remessa.emitente_cnpj)})</span>
                <span>Destinatario: {remessa.destinatario_razao_social || '—'} ({formatCnpj(remessa.destinatario_cnpj)})</span>
                <span>Emissao: {remessa.data_emissao ? formatDate(remessa.data_emissao) : '—'}</span>
                <span className="font-medium text-foreground">Valor: {formatCurrency(remessa.valor_total)}</span>
              </div>
              {!remessa.referencia_nf_venda_confirmada && (
                <p className="text-xs text-amber-700">Sem referencia estruturada (NFref) a esta NF de venda.</p>
              )}
              {remessa.motivos_validacao.length > 0 && (
                <ul className="list-inside list-disc text-xs text-muted-foreground">
                  {remessa.motivos_validacao.map((motivo, index) => <li key={index}>{motivo}</li>)}
                </ul>
              )}
              <div>
                <button type="button" className="text-xs font-medium text-primary underline-offset-2 hover:underline" onClick={() => abrirArquivo(remessa.id)}>
                  Abrir XML
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}
