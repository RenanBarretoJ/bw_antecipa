'use client'

import { useTransition } from 'react'
import { AlertTriangle, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useNotifications } from '@/components/notifications/notification-provider'
import { vincularCedenteAoFundo } from '@/lib/actions/onboarding-cedentes'
import { formatCnpj } from './utils'
import type { FundoResumo, OnboardingCedente } from './types'

type Props = {
  open: boolean
  cedente: OnboardingCedente | null
  fundo: FundoResumo | null
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function VincularFundoDialog({ open, cedente, fundo, onOpenChange, onSuccess }: Props) {
  const notifications = useNotifications()
  const [isPending, startTransition] = useTransition()

  function submit() {
    if (!cedente || !fundo) return
    startTransition(async () => {
      const result = await vincularCedenteAoFundo({ cedenteId: cedente.id, fundoId: fundo.id })
      notifications.notify({
        type: result.success ? 'success' : 'error',
        message: result.message,
        dedupeKey: `vincular-fundo:${result.message}`,
      })
      if (result.success) {
        onOpenChange(false)
        onSuccess()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4 text-primary" aria-hidden="true" />
            Vincular fundo
          </DialogTitle>
          <DialogDescription>
            O cedente sera vinculado ao fundo ativo. A politica operacional sera definida na proxima etapa.
          </DialogDescription>
        </DialogHeader>

        {cedente && fundo && (
          <div className="space-y-3">
            <div className="grid gap-3 rounded-xl border bg-muted/40 p-3 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Cedente</p>
                <p className="mt-1 truncate font-semibold" title={cedente.razaoSocial}>{cedente.razaoSocial}</p>
                <p className="text-sm text-muted-foreground">{formatCnpj(cedente.cnpj)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Fundo ativo autorizado</p>
                <p className="mt-1 truncate font-semibold" title={fundo.nome}>{fundo.nome}</p>
                <p className="text-sm text-muted-foreground">{fundo.cnpj ? formatCnpj(fundo.cnpj) : 'CNPJ nao informado'}</p>
              </div>
            </div>
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="size-4" aria-hidden="true" />
                Confira os dados antes de confirmar
              </p>
              <p className="mt-1 text-muted-foreground">
                A vinculacao sera auditada e nao cria uma politica automaticamente.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancelar</Button>
          <Button type="button" onClick={submit} disabled={!cedente || !fundo || isPending}>
            {isPending ? 'Vinculando...' : 'Vincular fundo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
