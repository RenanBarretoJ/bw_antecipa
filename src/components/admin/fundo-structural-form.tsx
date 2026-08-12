'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck } from 'lucide-react'
import { criarFundoAdmin, atualizarFundoAdmin } from '@/app/admin/fundos/actions'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AdminFundoDetalhe, AdminFundoActionResult } from '@/lib/admin/fundos'

const fields = [
  ['nome', 'Nome do fundo', true],
  ['cnpj', 'CNPJ do fundo', true],
  ['administradora_nome', 'Administradora', true],
  ['administradora_cnpj', 'CNPJ da administradora', true],
  ['gestora_nome', 'Gestora', true],
  ['gestora_cnpj', 'CNPJ da gestora', true],
  ['custodiante_nome', 'Custodiante', false],
  ['custodiante_cnpj', 'CNPJ do custodiante', false],
  ['administradora_endereco', 'Endereco da administradora', false],
  ['administradora_ato_declaratorio', 'Ato declaratorio', false],
  ['contato_nome', 'Contato', false],
  ['contato_email', 'E-mail do contato', false],
] as const

export function FundoStructuralForm({ fundo }: { fundo?: AdminFundoDetalhe }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [pending, startTransition] = useTransition()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  function submit(formData: FormData) {
    startTransition(async () => {
      const result: AdminFundoActionResult = fundo ? await atualizarFundoAdmin(formData) : await criarFundoAdmin(formData)
      setFieldErrors(result.fieldErrors || {})
      notifications.fromActionResult(result)
      if (!result.success || !result.data) return
      if (!fundo) router.push(`/admin/fundos/${result.data.id}`)
      router.refresh()
    })
  }

  return (
    <form action={submit} className="space-y-5">
      {fundo && <><input type="hidden" name="fundo_id" value={fundo.id} /><input type="hidden" name="updated_at" value={fundo.updated_at} /></>}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(([name, label, required]) => (
          <div key={name} className={name === 'administradora_endereco' ? 'sm:col-span-2' : ''}>
            <Label htmlFor={`fundo-${name}`} className="mb-2">{label}{required ? ' *' : ''}</Label>
            <Input id={`fundo-${name}`} name={name} required={required} defaultValue={fundo?.[name] || ''} aria-invalid={Boolean(fieldErrors[name]?.length)} />
            {fieldErrors[name]?.[0] && <p className="mt-1 text-xs text-destructive">{fieldErrors[name][0]}</p>}
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-info/30 bg-info/5 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-info-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <Label htmlFor="fundo-mfa">Confirmacao TOTP *</Label>
            <p className="mb-2 mt-1 text-xs text-muted-foreground">Informe o codigo atual do autenticador. A autorizacao e valida somente para esta acao.</p>
            <Input id="fundo-mfa" name="mfa_code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className="max-w-48 font-mono tracking-[0.35em]" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>Cancelar</Button>
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{fundo ? 'Salvar alteracoes' : 'Criar fundo inativo'}</Button>
      </div>
    </form>
  )
}
