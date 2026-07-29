'use client'

import { useEffect, useState, useTransition } from 'react'
import { Check, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNotifications } from '@/components/notifications/notification-provider'
import { carregarContextoOnboardingCedente } from '@/lib/actions/onboarding-cedentes'
import { vincularPoliticaAoCedenteFundo } from '@/lib/actions/politica'
import { formatCnpj } from './utils'
import type { ContextoOnboardingCedente, OnboardingCedente } from './types'

type Props = {
  open: boolean
  cedente: OnboardingCedente | null
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function DefinirPoliticaDialog({ open, cedente, onOpenChange, onSuccess }: Props) {
  const notifications = useNotifications()
  const [contexto, setContexto] = useState<ContextoOnboardingCedente | null>(null)
  const [politicaId, setPoliticaId] = useState('')
  const [vigenteDesde, setVigenteDesde] = useState(today())
  const [motivo, setMotivo] = useState('')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!open || !cedente) return
    let active = true
    void carregarContextoOnboardingCedente(cedente.id).then((result) => {
      if (!active) return
      if (!result.success || !result.data) {
        notifications.error(result.message || 'Nao foi possivel carregar as politicas do fundo.')
        return
      }
      setContexto(result.data)
    })
    return () => {
      active = false
    }
  }, [cedente, notifications, open])

  function close() {
    setContexto(null)
    setPoliticaId('')
    setVigenteDesde(today())
    setMotivo('')
    onOpenChange(false)
  }

  function submit() {
    if (!contexto?.vinculo) return
    const contextoAtual = contexto
    const vinculo = contexto.vinculo
    startTransition(async () => {
      const effectiveDate = vigenteDesde ? `${vigenteDesde}T00:00:00.000Z` : undefined
      const result = await vincularPoliticaAoCedenteFundo(
        contextoAtual.fundo.id,
        vinculo.id,
        politicaId,
        effectiveDate,
        motivo,
      )
      notifications.notify({
        type: result.success ? 'success' : 'error',
        message: result.message || 'Falha ao definir politica.',
        dedupeKey: `definir-politica:${result.message}`,
      })
      if (result.success) {
        close()
        onSuccess()
      }
    })
  }

  const selected = contexto?.politicasDisponiveis.find((politica) => politica.id === politicaId) || null
  const loading = Boolean(open && cedente && contexto?.cedente.id !== cedente.id)

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            Definir politica operacional
          </DialogTitle>
          <DialogDescription>
            As opcoes publicadas sao carregadas sob demanda para o fundo ativo.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="rounded-xl border p-4 text-sm text-muted-foreground">Carregando politicas publicadas...</p>
        ) : contexto ? (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-xl border bg-muted/40 p-3 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Cedente</p>
                <p className="mt-1 truncate font-semibold" title={contexto.cedente.razaoSocial}>{contexto.cedente.razaoSocial}</p>
                <p className="text-sm text-muted-foreground">{formatCnpj(contexto.cedente.cnpj)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Fundo</p>
                <p className="mt-1 truncate font-semibold" title={contexto.fundo.nome}>{contexto.fundo.nome}</p>
                <p className="text-sm text-muted-foreground">{contexto.fundo.cnpj ? formatCnpj(contexto.fundo.cnpj) : 'CNPJ nao informado'}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Politicas publicadas do fundo</Label>
              <div className="max-h-60 space-y-2 overflow-auto rounded-xl border p-2">
                {contexto.politicasDisponiveis.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">Nenhuma politica ativa com versao publicada neste fundo.</p>
                ) : contexto.politicasDisponiveis.map((politica) => (
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
                        v{politica.numeroVersao} publicada · {politica.requisitoCount} requisito(s)
                      </span>
                    </span>
                    {politicaId === politica.id && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="vigente-desde">Inicio da vigencia</Label>
                <Input id="vigente-desde" type="date" value={vigenteDesde} onChange={(event) => setVigenteDesde(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="motivo-politica">Motivo</Label>
                <Input id="motivo-politica" value={motivo} onChange={(event) => setMotivo(event.target.value)} placeholder="Ex.: politica padrao do fundo" />
              </div>
            </div>

            <div className="rounded-xl border bg-muted/30 p-3 text-sm">
              <p className="font-medium">Resumo</p>
              <p className="mt-1 text-muted-foreground">
                {selected
                  ? `${selected.nome} · v${selected.numeroVersao} · ${selected.requisitoCount} requisito(s)`
                  : 'Selecione uma politica publicada.'}
              </p>
            </div>
          </div>
        ) : (
          <p className="rounded-xl border p-4 text-sm text-muted-foreground">Contexto indisponivel.</p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={isPending}>Cancelar</Button>
          <Button type="button" onClick={submit} disabled={!contexto?.vinculo || !politicaId || isPending}>
            {isPending ? 'Salvando...' : 'Definir politica'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
