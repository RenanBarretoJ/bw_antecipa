'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { criarConsultoriaAdmin } from '@/app/admin/consultorias/actions'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AdminFundoListItem } from '@/lib/admin/fundos'

export function ConsultoriaCreateForm({ fundos }: { fundos: AdminFundoListItem[] }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string[]>>({})

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await criarConsultoriaAdmin(formData)
      notifications.fromActionResult(result)
      setErrors(result.fieldErrors || {})
      if (result.success && result.data?.id) router.push(`/admin/consultorias/${result.data.id}`)
    })
  }

  const field = (name: string) => errors[name]?.map((error) => <p key={error} className="mt-1 text-xs text-destructive">{error}</p>)

  return (
    <form action={submit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="consultoria-cnpj" className="mb-2">CNPJ *</Label><Input id="consultoria-cnpj" name="cnpj" required inputMode="numeric" />{field('cnpj')}</div>
        <div><Label htmlFor="consultoria-razao" className="mb-2">Razao Social *</Label><Input id="consultoria-razao" name="razaoSocial" required />{field('razaoSocial')}</div>
        <div className="sm:col-span-2"><Label htmlFor="consultoria-fantasia" className="mb-2">Nome Fantasia</Label><Input id="consultoria-fantasia" name="nomeFantasia" />{field('nomeFantasia')}</div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Fundos autorizados *</legend>
        <p className="mt-1 text-sm text-muted-foreground">Somente Fundos ativos podem ser concedidos. O OWNER nao podera ampliar este escopo.</p>
        <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2">
          {fundos.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum Fundo ativo disponivel.</p> : fundos.map((fundo) => (
            <label key={fundo.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 hover:bg-muted">
              <input type="checkbox" name="fundoIds" value={fundo.id} className="mt-1" />
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{fundo.nome}</span><span className="text-xs text-muted-foreground">{fundo.cnpj}</span></span>
            </label>
          ))}
        </div>
        {field('fundoIds')}
      </fieldset>

      <fieldset className="space-y-4 rounded-xl border border-border p-4">
        <legend className="px-2 text-sm font-semibold">Primeiro usuario OWNER</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="owner-nome" className="mb-2">Nome *</Label><Input id="owner-nome" name="ownerNome" required autoComplete="name" />{field('ownerNome')}</div>
          <div><Label htmlFor="owner-email" className="mb-2">E-mail *</Label><Input id="owner-email" name="ownerEmail" type="email" required autoComplete="email" />{field('ownerEmail')}</div>
        </div>
        <p className="text-sm text-muted-foreground">A senha nao e definida pelo administrador. O usuario recebera convite individual e configurara MFA no primeiro acesso.</p>
      </fieldset>

      <div className="max-w-xs"><Label htmlFor="consultoria-mfa" className="mb-2">Codigo TOTP para confirmar</Label><Input id="consultoria-mfa" name="mfa_code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="font-mono tracking-[0.35em]" /></div>
      <div className="flex justify-end"><Button type="submit" disabled={pending || fundos.length === 0}>{pending && <Loader2 className="animate-spin" />}Criar e enviar convite</Button></div>
    </form>
  )
}
