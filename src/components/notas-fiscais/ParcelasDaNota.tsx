'use client'

import { useEffect, useState } from 'react'
import { Receipt } from 'lucide-react'
import {
  editarParcelasDaNota,
  listarParcelasDaNota,
  type ParcelaDaNotaItem,
} from '@/lib/actions/parcelas-nf'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency, formatDate } from '@/lib/utils'

type Mode = 'cedente' | 'gestor'

const statusFinanceiroLabel: Record<string, string> = {
  disponivel: 'Disponível',
  em_operacao: 'Em operação',
  liquidada: 'Liquidada',
  cancelada: 'Cancelada',
}

const origemLabel: Record<string, string> = {
  xml_nfe: 'XML da NF-e',
  manual: 'Manual/PDF',
}

/**
 * Secao "Parcelas da Nota Fiscal" -- independente de a politica exigir
 * boleto (o card de Boleto continua exclusivamente documental, dentro do
 * checklist). NF sem parcelas nao renderiza nada (comportamento legado).
 */
export function ParcelasDaNota({
  notaFiscalId,
  mode,
  onTemParcelas,
}: {
  notaFiscalId: string
  mode: Mode
  /** Notifica o componente pai se a NF tem (>0) ou nao tem parcelas, apos o carregamento. */
  onTemParcelas?: (temParcelas: boolean) => void
}) {
  const notifications = useNotifications()
  const [itens, setItens] = useState<ParcelaDaNotaItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [editavel, setEditavel] = useState(false)
  const [rascunho, setRascunho] = useState<Record<string, { valorNominal: string; dataVencimento: string }>>({})
  const [salvando, setSalvando] = useState(false)

  const load = async () => {
    const result = await listarParcelasDaNota(notaFiscalId)
    if (!result.success || !result.data) {
      if (!result.success) notifications.error(result.message)
      setItens([])
      onTemParcelas?.(false)
      return
    }
    setItens(result.data.itens)
    setTotal(result.data.total)
    setEditavel(result.data.editavel)
    setRascunho(Object.fromEntries(result.data.itens.map((item) => [
      item.id,
      { valorNominal: item.valorNominal.toFixed(2), dataVencimento: item.dataVencimento },
    ])))
    onTemParcelas?.(result.data.itens.length > 0)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notaFiscalId])

  if (itens === null || itens.length === 0) return null

  const salvar = async () => {
    setSalvando(true)
    const payload = itens.map((item) => ({
      id: item.id,
      valorNominal: Number(rascunho[item.id]?.valorNominal ?? item.valorNominal),
      dataVencimento: rascunho[item.id]?.dataVencimento ?? item.dataVencimento,
    }))
    const result = await editarParcelasDaNota(notaFiscalId, payload)
    notifications.fromActionResult(result, 'Parcelas atualizadas.')
    if (result.success) await load()
    setSalvando(false)
  }

  const podeEditar = mode === 'cedente' && editavel

  return (
    <article className="rounded-xl border bg-background">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Receipt size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">Parcelas da Nota Fiscal</p>
          <p className="text-xs text-muted-foreground">{itens.length} parcela(s) · Total {formatCurrency(total)}</p>
        </div>
        {podeEditar && (
          <Button type="button" size="sm" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar parcelas'}
          </Button>
        )}
      </div>

      <div className="border-t border-border">
        <div className={`hidden gap-2 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground md:grid ${podeEditar ? 'grid-cols-[3.5rem_9rem_9rem_8rem_8rem]' : 'grid-cols-[3.5rem_7rem_8rem_8rem_8rem]'}`}>
          <span>Parcela</span>
          <span>Vencimento</span>
          <span>Valor nominal</span>
          <span>Status</span>
          <span>Origem</span>
        </div>
        <div className="divide-y divide-border">
          {itens.map((item) => {
            const draft = rascunho[item.id] ?? { valorNominal: item.valorNominal.toFixed(2), dataVencimento: item.dataVencimento }
            const numero = String(item.numeroParcela).padStart(3, '0')
            const statusLabel = statusFinanceiroLabel[item.status] || item.status
            const origem = origemLabel[item.origem] || item.origem

            return (
              <div key={item.id}>
                {/* Mobile: card empilhado, sem scroll horizontal. */}
                <div className="flex flex-col gap-2 px-4 py-3 text-sm md:hidden">
                  <div className="flex items-center justify-between">
                    <span className="font-mono tabular-nums text-muted-foreground">Parcela {numero}</span>
                    <span className="text-muted-foreground">{statusLabel}</span>
                  </div>
                  {podeEditar ? (
                    <div className="flex flex-wrap gap-2">
                      <Input
                        type="date"
                        className="h-8 flex-1"
                        value={draft.dataVencimento}
                        onChange={(event) => setRascunho((atual) => ({ ...atual, [item.id]: { ...draft, dataVencimento: event.target.value } }))}
                      />
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="h-8 flex-1"
                        value={draft.valorNominal}
                        onChange={(event) => setRascunho((atual) => ({ ...atual, [item.id]: { ...draft, valorNominal: event.target.value } }))}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Venc. {formatDate(item.dataVencimento)}</span>
                      <span className="font-medium tabular-nums text-foreground">{formatCurrency(item.valorNominal)}</span>
                    </div>
                  )}
                  <div className="text-muted-foreground">Origem: {origem}</div>
                </div>

                {/* Desktop: linha de tabela. */}
                <div className={`hidden items-center gap-2 px-4 py-2.5 text-sm md:grid ${podeEditar ? 'grid-cols-[3.5rem_9rem_9rem_8rem_8rem]' : 'grid-cols-[3.5rem_7rem_8rem_8rem_8rem]'}`}>
                  <span className="font-mono tabular-nums text-muted-foreground">{numero}</span>
                  {podeEditar ? (
                    <>
                      <Input
                        type="date"
                        className="h-8"
                        value={draft.dataVencimento}
                        onChange={(event) => setRascunho((atual) => ({ ...atual, [item.id]: { ...draft, dataVencimento: event.target.value } }))}
                      />
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="h-8"
                        value={draft.valorNominal}
                        onChange={(event) => setRascunho((atual) => ({ ...atual, [item.id]: { ...draft, valorNominal: event.target.value } }))}
                      />
                    </>
                  ) : (
                    <>
                      <span className="tabular-nums">{formatDate(item.dataVencimento)}</span>
                      <span className="font-medium tabular-nums">{formatCurrency(item.valorNominal)}</span>
                    </>
                  )}
                  <span className="text-muted-foreground">{statusLabel}</span>
                  <span className="text-muted-foreground">{origem}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </article>
  )
}
