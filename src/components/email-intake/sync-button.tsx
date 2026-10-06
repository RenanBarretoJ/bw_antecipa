'use client'

import { useState, useTransition } from 'react'
import { sinalizarSincronizacaoEmail } from '@/app/actions/email-automation'
import { Button } from '@/components/ui/button'

export function EmailSyncButton({ integrationId, disabled }: { integrationId: string; disabled: boolean }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  return <div className="space-y-2">
    <Button className="min-h-11 px-4" variant="outline" disabled={disabled || pending} onClick={() => startTransition(async () => {
      const result = await sinalizarSincronizacaoEmail(integrationId)
      setMessage(result.status === 'ERROR' ? result.message : result.status === 'QUEUED'
        ? 'Sincronização solicitada. O processamento ocorrerá em segundo plano.' : 'Já existe uma sincronização solicitada.')
    })}>{pending ? 'Solicitando...' : 'Sincronizar agora'}</Button>
    {message && <p className="text-sm text-muted-foreground" role="status">{message}</p>}
  </div>
}
