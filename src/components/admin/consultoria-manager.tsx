'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import {
  alterarStatusConsultoriaAdmin,
  atualizarFundosConsultoriaAdmin,
  atualizarUsuarioConsultoriaAdmin,
  convidarUsuarioConsultoriaAdmin,
} from '@/app/admin/consultorias/actions'
import { SensitiveConfirmDialog } from '@/components/admin/sensitive-confirm-dialog'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AdminFundoListItem } from '@/lib/admin/fundos'
import type { AdminConsultoriaDetalhe, AdminConsultoriaUsuario, ConsultoriaPapel } from '@/lib/admin/consultorias'

export function ConsultoriaLifecycleAction({ consultoria }: { consultoria: AdminConsultoriaDetalhe }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const ativar = consultoria.status !== 'ativo'
  return (
    <>
      <Button variant={ativar ? 'default' : 'destructive'} onClick={() => setOpen(true)}>{ativar ? 'Reativar' : 'Desativar'}</Button>
      <SensitiveConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`${ativar ? 'Reativar' : 'Desativar'} Consultoria`}
        description={ativar ? 'Os usuarios ativos voltarao a resolver a carteira conforme seus papeis.' : 'Todos os usuarios perderao C2/C3/C4 imediatamente, sem apagar a carteira.'}
        confirmLabel={ativar ? 'Reativar' : 'Desativar'}
        pending={pending}
        destructive={!ativar}
        onConfirm={(mfaCode) => startTransition(async () => {
          const result = await alterarStatusConsultoriaAdmin({ consultorId: consultoria.id, ativar, mfaCode })
          notifications.fromActionResult(result)
          if (result.success) { setOpen(false); router.refresh() }
        })}
      />
    </>
  )
}

export function ConsultoriaInviteForm({ consultorId, disabled }: { consultorId: string; disabled: boolean }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string[]>>({})
  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await convidarUsuarioConsultoriaAdmin(formData)
      notifications.fromActionResult(result)
      setErrors(result.fieldErrors || {})
      if (result.success) router.refresh()
    })
  }
  return (
    <form action={submit} className="grid gap-3 md:grid-cols-[minmax(150px,1fr)_minmax(220px,1.2fr)_150px_180px_auto]">
      <input type="hidden" name="consultorId" value={consultorId} />
      <div><Label htmlFor="novo-consultor-nome" className="mb-2">Nome</Label><Input id="novo-consultor-nome" name="nome" required disabled={disabled} />{errors.nome?.map((e) => <p key={e} className="mt-1 text-xs text-destructive">{e}</p>)}</div>
      <div><Label htmlFor="novo-consultor-email" className="mb-2">E-mail</Label><Input id="novo-consultor-email" name="email" type="email" required disabled={disabled} />{errors.email?.map((e) => <p key={e} className="mt-1 text-xs text-destructive">{e}</p>)}</div>
      <div><Label htmlFor="novo-consultor-papel" className="mb-2">Papel</Label><select id="novo-consultor-papel" name="papel" defaultValue="OPERADOR" disabled={disabled} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"><option value="ADMIN">ADMIN</option><option value="OPERADOR">OPERADOR</option><option value="LEITOR">LEITOR</option></select></div>
      <div><Label htmlFor="novo-consultor-mfa" className="mb-2">Codigo TOTP</Label><Input id="novo-consultor-mfa" name="mfa_code" required maxLength={6} inputMode="numeric" className="font-mono tracking-[0.25em]" disabled={disabled} /></div>
      <div className="flex items-end"><Button type="submit" disabled={disabled || pending}>{pending && <Loader2 className="animate-spin" />}Convidar</Button></div>
    </form>
  )
}

export function ConsultoriaUserRow({ consultorId, usuario }: { consultorId: string; usuario: AdminConsultoriaUsuario }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [papel, setPapel] = useState<ConsultoriaPapel>(usuario.papel)
  const [ativo, setAtivo] = useState(usuario.status === 'ativo')
  const [mfaCode, setMfaCode] = useState('')
  const [pending, startTransition] = useTransition()
  const pendente = usuario.status === 'pendente'
  return (
    <div className="grid items-end gap-3 py-3 first:pt-0 last:pb-0 lg:grid-cols-[minmax(180px,1fr)_150px_130px_160px_auto]">
      <div className="min-w-0"><p className="truncate text-sm font-semibold">{usuario.nome}</p><p className="truncate text-xs text-muted-foreground">{usuario.email}</p></div>
      <div><Label className="mb-2">Papel</Label><select value={papel} onChange={(e) => setPapel(e.target.value as ConsultoriaPapel)} disabled={pendente || usuario.papel === 'OWNER'} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm">{usuario.papel === 'OWNER' && <option value="OWNER">OWNER</option>}<option value="ADMIN">ADMIN</option><option value="OPERADOR">OPERADOR</option><option value="LEITOR">LEITOR</option></select></div>
      <div><Label className="mb-2">Status</Label><select value={ativo ? 'ativo' : 'inativo'} onChange={(e) => setAtivo(e.target.value === 'ativo')} disabled={pendente} className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm">{pendente && <option value="inativo">Pendente</option>}<option value="ativo">Ativo</option><option value="inativo">Inativo</option></select></div>
      <div><Label className="mb-2">Codigo TOTP</Label><Input value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={pendente} maxLength={6} inputMode="numeric" className="font-mono tracking-[0.25em]" /></div>
      <Button variant="outline" disabled={pendente || pending || mfaCode.length !== 6} onClick={() => startTransition(async () => {
        const result = await atualizarUsuarioConsultoriaAdmin({ consultorId, userId: usuario.user_id, papel, ativar: ativo, mfaCode })
        notifications.fromActionResult(result)
        if (result.success) { setMfaCode(''); router.refresh() }
      })}>{pending && <Loader2 className="animate-spin" />}Salvar</Button>
    </div>
  )
}

export function ConsultoriaFundsForm({ consultoria, fundos }: { consultoria: AdminConsultoriaDetalhe; fundos: AdminFundoListItem[] }) {
  const router = useRouter()
  const notifications = useNotifications()
  const initial = consultoria.fundos.filter((item) => item.status === 'ativo').map((item) => item.id)
  const [selected, setSelected] = useState(initial)
  const [mfaCode, setMfaCode] = useState('')
  const [pending, startTransition] = useTransition()
  function toggle(id: string) { setSelected((value) => value.includes(id) ? value.filter((item) => item !== id) : [...value, id]) }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Remover um Fundo revoga imediatamente o acesso operacional aos Cedentes desse Fundo, sem apagar historico.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {fundos.map((fundo) => <label key={fundo.id} className="flex cursor-pointer gap-2 rounded-lg border border-border p-3"><input type="checkbox" checked={selected.includes(fundo.id)} onChange={() => toggle(fundo.id)} /><span><span className="block text-sm font-medium">{fundo.nome}</span><span className="text-xs text-muted-foreground">{fundo.cnpj}</span></span></label>)}
      </div>
      <div className="flex flex-wrap items-end justify-end gap-3"><div className="w-44"><Label className="mb-2">Codigo TOTP</Label><Input value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} inputMode="numeric" className="font-mono tracking-[0.25em]" /></div><Button disabled={pending || mfaCode.length !== 6} onClick={() => startTransition(async () => {
        const result = await atualizarFundosConsultoriaAdmin({ consultorId: consultoria.id, fundoIds: selected, mfaCode })
        notifications.fromActionResult(result)
        if (result.success) { setMfaCode(''); router.refresh() }
      })}>{pending && <Loader2 className="animate-spin" />}Salvar Fundos</Button></div>
    </div>
  )
}
