'use client'

import { useEffect, useRef, useState } from 'react'
import { FileSignature } from 'lucide-react'
import { carregarContextoCanhotoDaNota, type CanhotoDaEntregaRegistro } from '@/lib/actions/canhoto-remessa'
import { enviarCanhoto } from '@/lib/actions/logistica'
import { listarRemessasDaNota, type RemessaDaNotaRegistro } from '@/lib/actions/nota-fiscal-remessa'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'

type Mode = 'cedente' | 'gestor'

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  enviado: 'Enviado',
  em_analise: 'Em analise',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  substituido: 'Substituido',
  cancelado: 'Cancelado',
}

/**
 * Card de canhoto (comprovante de entrega) vinculado a NF de venda. Regra F
 * do ticket NF de Remessa: quando um canhoto e enviado com uma NF de
 * remessa VALIDADA vinculada, exibe "Entrega comprovada via NF de Remessa
 * <numero>" -- mas a satisfacao do gate logistico da venda em si nunca
 * depende deste vinculo (canhotos.nota_fiscal_entrega_id ja e por venda).
 * So renderiza quando a NF tem acompanhamento logistico ativo (pos-cessao).
 */
export function CanhotoDaEntrega({ notaFiscalId, mode }: { notaFiscalId: string; mode: Mode }) {
  const notifications = useNotifications()
  const [contexto, setContexto] = useState<{ entregaId: string | null; canhotos: CanhotoDaEntregaRegistro[] } | null>(null)
  const [remessasValidadas, setRemessasValidadas] = useState<RemessaDaNotaRegistro[]>([])
  const [remessaSelecionada, setRemessaSelecionada] = useState<string>('')
  const [enviando, setEnviando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    const result = await carregarContextoCanhotoDaNota(notaFiscalId)
    if (!result.success || !result.data) {
      if (!result.success) notifications.error(result.message)
      setContexto(null)
      return
    }
    setContexto(result.data.aplicavel ? { entregaId: result.data.entregaId, canhotos: result.data.canhotos } : null)

    const remessas = await listarRemessasDaNota(notaFiscalId)
    if (remessas.success && remessas.data) {
      setRemessasValidadas(remessas.data.filter((r) => r.status_validacao === 'VALIDADA'))
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notaFiscalId])

  if (!contexto) return null

  const enviarArquivo = async (arquivo: File) => {
    if (!contexto.entregaId) return
    setEnviando(true)
    const formData = new FormData()
    formData.set('entregaId', contexto.entregaId)
    formData.set('arquivo', arquivo)
    if (remessaSelecionada) formData.set('notaFiscalRemessaId', remessaSelecionada)
    const result = await enviarCanhoto(formData)
    notifications.fromActionResult(result, 'Canhoto enviado para analise.')
    if (result?.success) await load()
    setEnviando(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <article className="rounded-xl border bg-background">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FileSignature size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">Canhoto (comprovante de entrega)</p>
          <p className="text-xs text-muted-foreground">
            {contexto.canhotos.length === 0 ? 'Nenhum canhoto enviado ainda.' : `${contexto.canhotos.length} canhoto(s) enviado(s)`}
          </p>
        </div>
      </div>

      {(mode === 'cedente' || mode === 'gestor') && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          {remessasValidadas.length > 0 && (
            <select
              className="h-8 rounded-lg border border-gray-300 px-2 text-sm"
              value={remessaSelecionada}
              onChange={(event) => setRemessaSelecionada(event.target.value)}
              aria-label="NF de remessa que comprova esta entrega"
            >
              <option value="">Entrega direta (sem remessa)</option>
              {remessasValidadas.map((remessa) => (
                <option key={remessa.id} value={remessa.id}>NF de Remessa {remessa.numero || remessa.chave_acesso}</option>
              ))}
            </select>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void enviarArquivo(file)
            }}
          />
          <Button type="button" size="sm" variant="outline" disabled={enviando} onClick={() => inputRef.current?.click()}>
            {enviando ? 'Enviando...' : 'Enviar canhoto'}
          </Button>
        </div>
      )}

      {contexto.canhotos.length > 0 && (
        <div className="divide-y divide-border border-t border-border">
          {contexto.canhotos.map((canhoto) => (
            <div key={canhoto.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">{formatDate(canhoto.created_at)}</span>
                <span className="text-muted-foreground">{STATUS_LABEL[canhoto.status] || canhoto.status}</span>
              </div>
              {canhoto.nome_recebedor && <span className="text-muted-foreground">Recebido por: {canhoto.nome_recebedor}</span>}
              {canhoto.remessa_numero && (
                <p className="font-medium text-primary">Entrega comprovada via NF de Remessa {canhoto.remessa_numero}</p>
              )}
              {canhoto.possui_ressalva && <p className="text-amber-700">Ressalva: {canhoto.descricao_ressalva}</p>}
            </div>
          ))}
        </div>
      )}
    </article>
  )
}
