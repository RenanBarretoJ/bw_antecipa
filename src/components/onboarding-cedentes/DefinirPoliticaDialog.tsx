'use client'

import { useMemo, useState, useTransition } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNotifications } from '@/components/notifications/notification-provider'
import { vincularPoliticaAoCedenteFundo } from '@/lib/actions/politica'
import { formatCnpj, shortName } from './utils'
import type { OnboardingCedente, OnboardingData, PoliticaVersaoResumo } from './types'

type Props = {
  open: boolean
  cedente: OnboardingCedente | null
  data: OnboardingData
  onOpenChange: (open: boolean) => void
  onSuccess: () => Promise<void> | void
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function DefinirPoliticaDialog({ open, cedente, data, onOpenChange, onSuccess }: Props) {
  const notifications = useNotifications()
  const [politicaId, setPoliticaId] = useState('')
  const [vigenteDesde, setVigenteDesde] = useState(today())
  const [motivo, setMotivo] = useState('')
  const [isPending, startTransition] = useTransition()

  const link = cedente?.activeLinks[0] || null
  const fundo = link ? data.fundos.find((item) => item.id === link.fundo_id) || null : null

  const policies = useMemo(() => {
    if (!link) return []
    return data.politicas
      .filter((politica) => politica.fundo_id === link.fundo_id && politica.status === 'ativa')
      .map((politica) => {
        const version = data.versoes
          .filter((item) => item.politica_operacional_id === politica.id && item.status === 'publicada' && item.publicada_em && !item.vigente_ate)
          .sort((a, b) => b.versao - a.versao)[0] || null
        const requisitoCount = version ? data.requisitos.filter((req) => req.politica_operacional_versao_id === version.id).length : 0
        return { politica, version, requisitoCount }
      })
      .filter((item): item is { politica: typeof item.politica; version: PoliticaVersaoResumo; requisitoCount: number } => Boolean(item.version))
  }, [data.politicas, data.requisitos, data.versoes, link])

  function resetAndClose() {
    setPoliticaId('')
    setVigenteDesde(today())
    setMotivo('')
    onOpenChange(false)
  }

  function submit() {
    if (!cedente || !link || !fundo) return
    startTransition(async () => {
      const effectiveDate = vigenteDesde ? `${vigenteDesde}T00:00:00.000Z` : undefined
      const result = await vincularPoliticaAoCedenteFundo(fundo.id, link.id, politicaId, effectiveDate, motivo)
      notifications.notify({ type: result.success ? 'success' : 'error', message: result.message || 'Falha ao definir politica.', dedupeKey: `definir-politica:${result.message}` })
      if (result.success) {
        await onSuccess()
        resetAndClose()
      }
    })
  }

  const selected = policies.find((item) => item.politica.id === politicaId) || null

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? onOpenChange(true) : resetAndClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            Definir política operacional
          </DialogTitle>
          <DialogDescription>
            Selecione uma política ativa do fundo. Novas operações usarão a versão publicada vigente.
          </DialogDescription>
        </DialogHeader>

        {cedente && (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-xl border bg-muted/40 p-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Cedente</p>
                <p className="mt-1 font-semibold" title={cedente.razao_social}>{shortName(cedente.razao_social, 45)}</p>
                <p className="text-sm text-muted-foreground">{formatCnpj(cedente.cnpj)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Fundo</p>
                <p className="mt-1 font-semibold">{fundo?.nome || 'Nao definido'}</p>
                <p className="text-sm text-muted-foreground">{fundo?.cnpj ? formatCnpj(fundo.cnpj) : 'Sem CNPJ'}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Políticas publicadas do fundo</Label>
              <div className="max-h-60 space-y-2 overflow-auto rounded-xl border p-2">
                {policies.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">Nenhuma política ativa com versão publicada neste fundo.</p>
                ) : policies.map(({ politica, version, requisitoCount }) => (
                  <button
                    key={politica.id}
                    type="button"
                    onClick={() => setPoliticaId(politica.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border bg-background p-3 text-left text-sm transition hover:bg-muted"
                    aria-pressed={politicaId === politica.id}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium" title={politica.nome}>{politica.nome}</span>
                      <span className="text-xs text-muted-foreground">
                        v{version.versao} publicada · {requisitoCount} requisito(s)
                      </span>
                    </span>
                    {politicaId === politica.id && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="vigente-desde">Início da vigência</Label>
                <Input id="vigente-desde" type="date" value={vigenteDesde} onChange={(event) => setVigenteDesde(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="motivo-politica">Motivo</Label>
                <Input id="motivo-politica" value={motivo} onChange={(event) => setMotivo(event.target.value)} placeholder="Ex.: política padrão do fundo" />
              </div>
            </div>

            <div className="rounded-xl border bg-muted/30 p-3 text-sm">
              <p className="font-medium">Resumo</p>
              <p className="mt-1 text-muted-foreground">
                {selected ? `${selected.politica.nome} · v${selected.version.versao} · ${selected.requisitoCount} requisito(s)` : 'Selecione uma política publicada.'}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={resetAndClose} disabled={isPending}>Cancelar</Button>
          <Button type="button" onClick={submit} disabled={!cedente || !link || !fundo || !politicaId || isPending}>
            {isPending ? 'Salvando...' : 'Definir política'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
