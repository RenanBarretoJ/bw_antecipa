'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { alterarStatusUsuarioAdmin, alterarSuperAdminAdmin, resetarMfaUsuarioAdmin } from '@/app/admin/usuarios/actions'
import { SensitiveConfirmDialog } from '@/components/admin/sensitive-confirm-dialog'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import type { AdminUsuarioDetalhe } from '@/lib/admin/usuarios'

type Action = 'status' | 'super_admin' | 'mfa' | null

export function AdminUserActions({ usuario, currentUserId }: { usuario: AdminUsuarioDetalhe; currentUserId: string }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [action, setAction] = useState<Action>(null)
  const [pending, startTransition] = useTransition()
  const ativo = usuario.status === 'ativo'
  const podeAlterarSuperAdmin = usuario.papel_primario === 'gestor'

  function execute(mfaCode: string) {
    startTransition(async () => {
      const result = action === 'status'
        ? await alterarStatusUsuarioAdmin({ usuarioId: usuario.id, ativar: !ativo, mfaCode })
        : action === 'super_admin'
          ? await alterarSuperAdminAdmin({ usuarioId: usuario.id, conceder: !usuario.super_admin, mfaCode })
          : await resetarMfaUsuarioAdmin({ usuarioId: usuario.id, mfaCode })
      notifications.fromActionResult(result)
      if (!result.success) return
      setAction(null)
      router.refresh()
    })
  }

  const content = action === 'status'
    ? { title: ativo ? 'Desativar usuario' : 'Reativar usuario', description: ativo ? 'O usuario perdera acesso a plataforma e suas sessoes serao invalidadas. Papeis, vinculos e historico serao preservados.' : 'O usuario voltara a acessar somente fundos com vinculo ativo e fundo estruturalmente ativo.', label: ativo ? 'Desativar usuario' : 'Reativar usuario', destructive: ativo }
    : action === 'super_admin'
      ? { title: usuario.super_admin ? 'Revogar Super Admin' : 'Conceder Super Admin', description: usuario.super_admin ? 'O papel primario Gestor e os fundos autorizados serao preservados. O ultimo Super Admin ativo nunca pode ser revogado.' : 'A capacidade administrativa sera adicionada sem ampliar o acesso operacional do Gestor.', label: usuario.super_admin ? 'Revogar capacidade' : 'Conceder capacidade', destructive: usuario.super_admin }
      : { title: 'Resetar MFA', description: 'Os fatores atuais e codigos de recuperacao serao invalidados. O usuario devera configurar MFA novamente no proximo acesso.', label: 'Resetar MFA', destructive: true }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant={ativo ? 'destructive' : 'default'} size="sm" onClick={() => setAction('status')} disabled={usuario.id === currentUserId}>{ativo ? 'Desativar' : 'Reativar'}</Button>
      {podeAlterarSuperAdmin && <Button variant="outline" size="sm" onClick={() => setAction('super_admin')} disabled={usuario.id === currentUserId}>{usuario.super_admin ? 'Revogar Super Admin' : 'Conceder Super Admin'}</Button>}
      <Button variant="outline" size="sm" onClick={() => setAction('mfa')} disabled={usuario.id === currentUserId}>Resetar MFA</Button>
      <SensitiveConfirmDialog open={action !== null} onOpenChange={(open) => !open && setAction(null)} title={content.title} description={content.description} confirmLabel={content.label} destructive={content.destructive} pending={pending} onConfirm={execute} />
    </div>
  )
}
