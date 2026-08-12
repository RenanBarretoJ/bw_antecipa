'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { alterarStatusFundoAdmin } from '@/app/admin/fundos/actions'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function FundoLifecycleAction({ fundoId, updatedAt, ativo }: { fundoId: string; updatedAt: string; ativo: boolean }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [open, setOpen] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  const [pending, startTransition] = useTransition()

  function confirm() {
    startTransition(async () => {
      const result = await alterarStatusFundoAdmin({ fundoId, updatedAt, ativar: !ativo, mfaCode })
      notifications.fromActionResult(result)
      if (!result.success) return
      setOpen(false)
      setMfaCode('')
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={ativo ? 'destructive' : 'default'} />}>
        {ativo ? 'Desativar fundo' : 'Ativar fundo'}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ativo ? 'Desativar fundo' : 'Ativar fundo'}</DialogTitle>
          <DialogDescription>{ativo ? 'O fundo deixara de aparecer nos contextos operacionais e jobs. O historico sera preservado.' : 'O fundo passara a estar disponivel para autorizacoes e configuracoes operacionais.'}</DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="lifecycle-mfa" className="mb-2">Codigo TOTP</Label>
          <Input id="lifecycle-mfa" value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="font-mono tracking-[0.35em]" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
          <Button variant={ativo ? 'destructive' : 'default'} onClick={confirm} disabled={pending || mfaCode.length !== 6}>{pending && <Loader2 className="animate-spin" />}Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
