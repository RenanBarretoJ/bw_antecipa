'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { alterarVinculoGestorAdmin } from '@/app/admin/usuarios/actions'
import { SensitiveConfirmDialog } from '@/components/admin/sensitive-confirm-dialog'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'

export function GestorFundAccessAction({ usuarioId, fundoId, status }: { usuarioId: string; fundoId: string; status: 'ativo' | 'suspenso' | 'revogado' | null }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const operacao = status === 'ativo' ? 'revogar' : status ? 'reativar' : 'vincular'
  const label = operacao === 'revogar' ? 'Revogar vinculo' : operacao === 'reativar' ? 'Reativar vinculo' : 'Vincular fundo'

  function execute(mfaCode: string) {
    startTransition(async () => {
      const result = await alterarVinculoGestorAdmin({ usuarioId, fundoId, operacao, mfaCode })
      notifications.fromActionResult(result)
      if (!result.success) return
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button variant={operacao === 'revogar' ? 'destructive' : 'outline'} size="sm" onClick={() => setOpen(true)}>{label}</Button>
      <SensitiveConfirmDialog open={open} onOpenChange={setOpen} title={label} description={operacao === 'revogar' ? 'A linha historica sera preservada como revogada e o acesso ao fundo cessara imediatamente.' : 'O vinculo sera ativado. O acesso operacional ainda depende de usuario e fundo ativos.'} confirmLabel={label} destructive={operacao === 'revogar'} pending={pending} onConfirm={execute} />
    </>
  )
}
