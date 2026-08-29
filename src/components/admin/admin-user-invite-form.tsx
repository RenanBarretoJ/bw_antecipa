'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Shield, UserRoundCog } from 'lucide-react'
import { convidarUsuarioAdmin } from '@/app/admin/usuarios/actions'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AdminFundoListItem } from '@/lib/admin/fundos'

export function AdminUserInviteForm({ fundos }: { fundos: AdminFundoListItem[] }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [tipo, setTipo] = useState<'gestor' | 'super_admin'>('gestor')
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string[]>>({})

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await convidarUsuarioAdmin(formData)
      notifications.fromActionResult(result)
      setErrors(result.fieldErrors || {})
      if (result.success && result.data?.id) router.push(`/admin/usuarios/${result.data.id}`)
    })
  }

  return (
    <form action={submit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="invite-name" className="mb-2">Nome</Label><Input id="invite-name" name="nome" required autoComplete="name" />{errors.nome?.map((error) => <p key={error} className="mt-1 text-xs text-destructive">{error}</p>)}</div>
        <div><Label htmlFor="invite-email" className="mb-2">E-mail</Label><Input id="invite-email" name="email" type="email" required autoComplete="email" />{errors.email?.map((error) => <p key={error} className="mt-1 text-xs text-destructive">{error}</p>)}</div>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Tipo administrativo</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${tipo === 'gestor' ? 'border-primary bg-primary/5' : 'border-border'}`}><input type="radio" name="tipo" value="gestor" checked={tipo === 'gestor'} onChange={() => setTipo('gestor')} /><UserRoundCog className="size-5 text-primary" /><span><span className="block font-semibold">Gestor</span><span className="text-sm text-muted-foreground">Recebe somente os fundos vinculados explicitamente.</span></span></label>
          <label className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${tipo === 'super_admin' ? 'border-primary bg-primary/5' : 'border-border'}`}><input type="radio" name="tipo" value="super_admin" checked={tipo === 'super_admin'} onChange={() => setTipo('super_admin')} /><Shield className="size-5 text-primary" /><span><span className="block font-semibold">Super Admin puro</span><span className="text-sm text-muted-foreground">Administra a plataforma sem acesso operacional aos fundos.</span></span></label>
        </div>
      </fieldset>

      {tipo === 'gestor' && (
        <fieldset>
          <legend className="text-sm font-medium">Fundos iniciais <span className="font-normal text-muted-foreground">(opcional)</span></legend>
          <p className="mt-1 text-sm text-muted-foreground">Fundos inativos podem ser vinculados, mas so concedem contexto operacional depois da ativacao estrutural.</p>
          <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2">
            {fundos.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum fundo cadastrado.</p> : fundos.map((fundo) => (
              <label key={fundo.id} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-lg px-2 py-2 hover:bg-muted"><input type="checkbox" name="fundoIds" value={fundo.id} className="mt-1" /><span className="min-w-0"><span className="block truncate text-sm font-medium" title={fundo.nome}>{fundo.nome}</span><span className="text-xs text-muted-foreground">{fundo.ativo ? 'Ativo' : 'Inativo'}</span></span></label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="max-w-xs"><Label htmlFor="invite-mfa" className="mb-2">Codigo TOTP para confirmar</Label><Input id="invite-mfa" name="mfa_code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="font-mono tracking-[0.35em]" /></div>
      <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Enviar convite</Button></div>
    </form>
  )
}
