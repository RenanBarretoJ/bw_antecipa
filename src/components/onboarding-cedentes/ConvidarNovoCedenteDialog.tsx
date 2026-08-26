'use client'

import { useState, useTransition } from 'react'
import { Building2, Loader2, Mail, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNotifications } from '@/components/notifications/notification-provider'
import { convidarNovoCedente } from '@/lib/actions/convite-novo-cedente'
import { useCnpjConsulta } from '@/hooks/use-cadastro-autofill'
import type { CnpjDadosConsultados } from '@/lib/cadastro/types'
import type { FundoResumo } from './types'
import { formatCnpj } from './utils'

function somenteDigitos(value: string) {
  return value.replace(/\D/g, '').slice(0, 14)
}

export function ConvidarNovoCedenteDialog({
  open,
  fundo,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  fundo: FundoResumo | null
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const notifications = useNotifications()
  const [isPending, startTransition] = useTransition()
  const [cnpj, setCnpj] = useState('')
  const [email, setEmail] = useState('')
  const [preview, setPreview] = useState<CnpjDadosConsultados | null>(null)
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  const cnpjConsulta = useCnpjConsulta(setPreview)

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setCnpj('')
      setEmail('')
      setPreview(null)
      setErrors({})
    }
    onOpenChange(nextOpen)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!fundo) return
    setErrors({})
    startTransition(async () => {
      const result = await convidarNovoCedente({ fundoId: fundo.id, cnpj, email })
      notifications.notify({
        type: result.success ? 'success' : 'error',
        message: result.message,
        dedupeKey: `convite-novo-cedente:${result.message}`,
      })
      if (result.errors) setErrors(result.errors)
      if (result.success) {
        handleOpenChange(false)
        onSuccess()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="size-4 text-primary" aria-hidden="true" />
              Convidar novo Cedente
            </DialogTitle>
            <DialogDescription>
              O Cedente sera criado somente quando o responsavel aceitar o convite. O vinculo com o fundo ja nascera ativo.
            </DialogDescription>
          </DialogHeader>

          <div className="my-5 space-y-4">
            <div className="rounded-xl border bg-muted/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Fundo ativo</p>
              <p className="mt-1 truncate font-semibold" title={fundo?.nome}>{fundo?.nome || 'Nenhum fundo autorizado'}</p>
              {fundo?.cnpj && <p className="text-sm text-muted-foreground">{formatCnpj(fundo.cnpj)}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="convite-cnpj">CNPJ do Cedente</Label>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="convite-cnpj"
                  value={cnpj ? formatCnpj(cnpj) : ''}
                  onChange={(event) => {
                    const next = somenteDigitos(event.target.value)
                    setCnpj(next)
                    setPreview(null)
                    setErrors((current) => ({ ...current, cnpj: [] }))
                  }}
                  onBlur={() => { if (cnpj.length === 14) void cnpjConsulta.consultar(cnpj) }}
                  placeholder="00.000.000/0000-00"
                  className="pl-10"
                  aria-invalid={Boolean(errors.cnpj?.length)}
                />
              </div>
              {cnpjConsulta.consultando && <p className="text-xs text-muted-foreground">Consultando dados cadastrais...</p>}
              {(errors.cnpj?.[0] || cnpjConsulta.erro) && <p className="text-xs text-destructive">{errors.cnpj?.[0] || cnpjConsulta.erro}</p>}
            </div>

            {preview && (
              <div className="rounded-xl border border-info/30 bg-info/10 p-3 text-sm">
                <p className="font-semibold">{preview.razao_social}</p>
                <p className="text-muted-foreground">{preview.nome_fantasia || 'Nome fantasia nao informado'} · {preview.situacao_cadastral || 'Situacao nao informada'}</p>
                <p className="mt-1 text-xs text-muted-foreground">A consulta e apenas informativa; a integridade sera validada no servidor.</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="convite-email">E-mail do responsavel</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="convite-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setErrors((current) => ({ ...current, email: [] }))
                  }}
                  placeholder="responsavel@empresa.com.br"
                  className="pl-10"
                  aria-invalid={Boolean(errors.email?.length)}
                />
              </div>
              {errors.email?.[0] && <p className="text-xs text-destructive">{errors.email[0]}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>Cancelar</Button>
            <Button type="submit" disabled={!fundo || isPending || cnpj.length !== 14 || !email.trim()}>
              {isPending ? <><Loader2 className="size-4 animate-spin" /> Enviando...</> : 'Enviar convite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
