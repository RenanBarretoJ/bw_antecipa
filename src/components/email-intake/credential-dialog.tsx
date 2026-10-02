'use client'

import { useState, useTransition } from 'react'
import { criarCredencialEmail } from '@/app/actions/email-operations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'

export function EmailCredentialDialog({ fundoId, environment, open, onClose, onCreated }: {
  fundoId: string; environment: 'homologacao' | 'producao'; open: boolean; onClose: () => void
  onCreated: (id: string, name: string) => void
}) {
  const [pending, start] = useTransition(), [message, setMessage] = useState('')
  const [requestId] = useState(() => crypto.randomUUID())
  return <Dialog open={open} onOpenChange={value => { if (!value && !pending) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg dark:[--primary:oklch(0.48_0.19_259)]">
      <DialogTitle>Nova credencial de e-mail</DialogTitle>
      <DialogDescription>A credencial autoriza o acesso da plataforma ao Outlook e pode ser usada por caixas deste fundo. Solicite os dados abaixo ao administrador Microsoft.</DialogDescription>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault()
        const form = event.currentTarget, values = new FormData(form)
        setMessage('')
        start(async () => {
          const result = await criarCredencialEmail({ fundoId, environment, requestId, name: values.get('name'), tenantId: values.get('tenantId'),
            clientId: values.get('clientId'), clientSecret: values.get('clientSecret'), mfaCode: values.get('mfaCode') })
          if (!result.ok) { setMessage(result.message); return }
          onCreated(result.data.id, String(values.get('name')))
          form.reset()
          onClose()
        })
      }}>
        <p className="text-sm">Outlook · {environment === 'homologacao' ? 'Homologação' : 'Produção'} · Cofre de credenciais técnicas</p>
        <label className="block space-y-1">Nome da credencial<Input name="name" required minLength={2} maxLength={120} autoComplete="off" /></label>
        <label className="block space-y-1">Identificador da organização (Tenant ID)<Input name="tenantId" required autoComplete="off" pattern={'[a-fA-F0-9\\-]{36}'} /></label>
        <label className="block space-y-1">Identificador da aplicação (Client ID)<Input name="clientId" required autoComplete="off" pattern={'[a-fA-F0-9\\-]{36}'} /></label>
        <label className="block space-y-1">Segredo da aplicação<Input name="clientSecret" type="password" required maxLength={8192} autoComplete="new-password" /></label>
        <p className="text-sm text-muted-foreground">O segredo será criptografado no cofre existente e não será exibido novamente.</p>
        <label className="block space-y-1">Código de confirmação MFA<Input name="mfaCode" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" /></label>
        {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{pending ? 'Protegendo credencial…' : 'Salvar credencial'}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancelar</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}
