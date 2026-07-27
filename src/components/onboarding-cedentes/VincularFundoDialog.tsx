'use client'

import { useMemo, useState, useTransition } from 'react'
import { AlertTriangle, Check, Link2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNotifications } from '@/components/notifications/notification-provider'
import { vincularCedenteAoFundo } from '@/lib/actions/onboarding-cedentes'
import { formatCnpj, shortName } from './utils'
import type { FundoResumo, OnboardingCedente } from './types'

type Props = {
  open: boolean
  cedente: OnboardingCedente | null
  fundos: FundoResumo[]
  onOpenChange: (open: boolean) => void
  onSuccess: () => Promise<void> | void
}

export function VincularFundoDialog({ open, cedente, fundos, onOpenChange, onSuccess }: Props) {
  const notifications = useNotifications()
  const [query, setQuery] = useState('')
  const [fundoId, setFundoId] = useState('')
  const [isPending, startTransition] = useTransition()

  const availableFundos = useMemo(() => {
    if (!cedente) return []
    const linkedIds = new Set([...cedente.activeLinks, ...cedente.suspendedLinks].map((link) => link.fundo_id))
    const normalized = query.trim().toLowerCase()
    const digits = query.replace(/\D/g, '')
    return fundos
      .filter((fundo) => !linkedIds.has(fundo.id))
      .filter((fundo) => {
        if (!normalized) return true
        const text = `${fundo.nome} ${fundo.cnpj}`.toLowerCase()
        return text.includes(normalized) || (!!digits && fundo.cnpj.replace(/\D/g, '').includes(digits))
      })
  }, [cedente, fundos, query])

  function resetAndClose() {
    setQuery('')
    setFundoId('')
    onOpenChange(false)
  }

  function submit() {
    if (!cedente) return
    startTransition(async () => {
      const result = await vincularCedenteAoFundo({ cedenteId: cedente.id, fundoId })
      notifications.notify({ type: result.success ? 'success' : 'error', message: result.message, dedupeKey: `vincular-fundo:${result.message}` })
      if (result.success) {
        await onSuccess()
        resetAndClose()
      }
    })
  }

  const selectedFundo = fundos.find((fundo) => fundo.id === fundoId) || null

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4 text-primary" aria-hidden="true" />
            Vincular fundo
          </DialogTitle>
          <DialogDescription>
            O cedente sera habilitado no fundo escolhido. A politica operacional sera definida na proxima etapa.
          </DialogDescription>
        </DialogHeader>

        {cedente && (
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Cedente selecionado</p>
              <p className="mt-1 truncate font-semibold" title={cedente.razao_social}>{cedente.razao_social}</p>
              <p className="text-sm text-muted-foreground">{formatCnpj(cedente.cnpj)}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="buscar-fundo">Fundo autorizado</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input id="buscar-fundo" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou CNPJ do fundo" className="pl-9" />
              </div>
              <div className="max-h-56 space-y-2 overflow-auto rounded-xl border p-2">
                {availableFundos.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">Nenhum fundo disponivel para este cedente.</p>
                ) : availableFundos.map((fundo) => (
                  <button
                    type="button"
                    key={fundo.id}
                    onClick={() => setFundoId(fundo.id)}
                    className="flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border bg-background p-3 text-left text-sm transition hover:bg-muted"
                    aria-pressed={fundoId === fundo.id}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" title={fundo.nome}>{fundo.nome}</span>
                      <span className="block truncate text-xs text-muted-foreground" title={formatCnpj(fundo.cnpj)}>{formatCnpj(fundo.cnpj)}</span>
                    </span>
                    {fundoId === fundo.id && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="size-4" aria-hidden="true" />
                Conferencia antes de vincular
              </p>
              <p className="mt-1 truncate text-muted-foreground" title={selectedFundo ? `${selectedFundo.nome} · ${cedente.razao_social}` : cedente.razao_social}>
                Fundo: {selectedFundo ? selectedFundo.nome : 'nao selecionado'} · Cedente: {shortName(cedente.razao_social, 48)}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={isPending}>Cancelar</Button>
          <Button type="button" onClick={submit} disabled={!cedente || !fundoId || isPending}>
            {isPending ? 'Vinculando...' : 'Vincular fundo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
