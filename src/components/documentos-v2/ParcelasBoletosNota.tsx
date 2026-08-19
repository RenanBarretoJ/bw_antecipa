'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, ExternalLink } from 'lucide-react'
import {
  analisarBoletoDaParcela,
  enviarBoletoDaParcela,
  listarBeneficiariosElegiveisDaNota,
  listarParcelasBoletosDaNota,
  type ParcelaBoletoItem,
} from '@/lib/actions/parcelas-nf'
import { baixarVersaoDocumento } from '@/lib/actions/documento-v2'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/data-display/primitives'
import { formatCurrency, formatDate } from '@/lib/utils'

type Mode = 'cedente' | 'gestor'

const boletoStatusLabel: Record<string, string> = {
  pendente: 'Aguardando envio',
  enviado: 'Aguardando analise',
  em_analise: 'Aguardando analise',
  satisfeito: 'Aprovado',
  vencido: 'Vencido',
  dispensado: 'Dispensado',
  cancelado: 'Cancelado',
}

export function ParcelasBoletosNota({ notaFiscalId, mode }: { notaFiscalId: string; mode: Mode }) {
  const notifications = useNotifications()
  const [items, setItems] = useState<ParcelaBoletoItem[] | null>(null)
  const [beneficiarios, setBeneficiarios] = useState<Array<{ id: string; razaoSocial: string; cnpj: string; tipo: string }>>([])
  const [pending, setPending] = useState(false)

  const load = async () => {
    const [parcelasResult, beneficiariosResult] = await Promise.all([
      listarParcelasBoletosDaNota(notaFiscalId),
      mode === 'cedente' ? listarBeneficiariosElegiveisDaNota(notaFiscalId) : Promise.resolve({ success: true, data: [] as never[] }),
    ])
    if (parcelasResult.success) setItems(parcelasResult.data ?? [])
    else notifications.error(parcelasResult.message)
    if (beneficiariosResult.success) setBeneficiarios(beneficiariosResult.data ?? [])
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notaFiscalId])

  if (items === null) return null
  if (items.length === 0) return null

  const verDocumento = async (versaoId: string) => {
    const result = await baixarVersaoDocumento(versaoId)
    if (result.success && result.url) window.open(result.url, '_blank', 'noopener,noreferrer')
    else notifications.error(result.message || 'Nao foi possivel abrir o documento.')
  }

  const enviar = (formData: FormData) => {
    setPending(true)
    void enviarBoletoDaParcela(formData).then(async (result) => {
      notifications.fromActionResult(result)
      if (result.success) await load()
      setPending(false)
    })
  }

  const analisar = (formData: FormData) => {
    setPending(true)
    void analisarBoletoDaParcela(formData).then(async (result) => {
      notifications.fromActionResult(result)
      if (result.success) await load()
      setPending(false)
    })
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b p-4">
        <span className="rounded-lg bg-muted p-2"><CalendarClock className="h-4 w-4" /></span>
        <div>
          <h2 className="font-semibold">Parcelas / Boletos</h2>
          <p className="text-xs text-muted-foreground">Cada parcela da NF tem vencimento, valor e boleto proprios.</p>
        </div>
      </div>
      <div className="divide-y">
        {items.map((item) => (
          <div key={item.parcela.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4 text-sm">
              <span className="font-mono tabular-nums text-muted-foreground">{String(item.parcela.numero_parcela).padStart(3, '0')}</span>
              <span className="tabular-nums">{formatDate(item.parcela.data_vencimento)}</span>
              <span className="font-medium tabular-nums">{formatCurrency(item.parcela.valor_nominal)}</span>
              <StatusBadge status={item.status} label={`Boleto: ${boletoStatusLabel[item.status] || item.status}`} />
              {item.motivo && <span className="text-xs text-destructive">Motivo: {item.motivo}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {item.documentoVersaoId && (
                <Button type="button" size="sm" variant="outline" onClick={() => verDocumento(item.documentoVersaoId as string)}>
                  Ver documento<ExternalLink className="ml-1 size-3" />
                </Button>
              )}
              {mode === 'cedente' && item.status !== 'satisfeito' && item.requisitoId && (
                <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); enviar(new FormData(event.currentTarget)) }}>
                  <input type="hidden" name="nota_fiscal_id" value={notaFiscalId} />
                  <input type="hidden" name="requisito_id" value={item.requisitoId} />
                  <select name="estabelecimento_beneficiario_id" required defaultValue={item.beneficiarioEstabelecimentoId || ''} className="h-8 rounded-md border bg-background px-2 text-xs">
                    <option value="">Beneficiario...</option>
                    {beneficiarios.map((b) => (
                      <option key={b.id} value={b.id}>{b.tipo === 'matriz' ? 'Matriz' : 'Filial'} - {b.razaoSocial}</option>
                    ))}
                  </select>
                  <Input className="h-8 w-40" type="file" name="arquivo" accept="application/pdf" required />
                  <Button type="submit" size="sm" variant="outline" disabled={pending}>Enviar boleto</Button>
                </form>
              )}
              {mode === 'gestor' && item.documentoVersaoId && item.status !== 'satisfeito' && (
                <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); analisar(new FormData(event.currentTarget)) }}>
                  <input type="hidden" name="nota_fiscal_id" value={notaFiscalId} />
                  <input type="hidden" name="documento_versao_id" value={item.documentoVersaoId} />
                  <Input className="h-8 w-48" name="observacoes" placeholder="Motivo (reprovar/ajuste)" />
                  <Button type="button" size="sm" disabled={pending} onClick={(event) => submeterAnaliseBoleto(event, 'aprovado')}>Aprovar</Button>
                  <Button type="button" size="sm" variant="outline" disabled={pending} onClick={(event) => submeterAnaliseBoleto(event, 'requer_ajuste')}>Pedir ajuste</Button>
                  <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={(event) => submeterAnaliseBoleto(event, 'rejeitado')}>Reprovar</Button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function submeterAnaliseBoleto(event: { currentTarget: HTMLButtonElement }, resultado: 'aprovado' | 'rejeitado' | 'requer_ajuste') {
  const form = event.currentTarget.form
  if (!form) return
  const hidden = form.querySelector<HTMLInputElement>('input[name="resultado"]') || document.createElement('input')
  hidden.type = 'hidden'
  hidden.name = 'resultado'
  hidden.value = resultado
  if (!hidden.isConnected) form.appendChild(hidden)
  form.requestSubmit()
}
