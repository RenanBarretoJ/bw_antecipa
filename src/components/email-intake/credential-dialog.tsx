'use client'

import { useState, useTransition } from 'react'
import { KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
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
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl dark:[--primary:oklch(0.48_0.19_259)]">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-primary/10 p-3 text-primary"><KeyRound className="size-5" aria-hidden="true" /></span><DialogTitle>Nova credencial de e-mail</DialogTitle></div>
      <DialogDescription>Autorize o acesso ao Outlook para as caixas deste fundo. Tenha em mãos os dados fornecidos pelo administrador Microsoft.</DialogDescription>
      <form className="space-y-5 [&_label]:text-sm [&_label]:font-medium [&_input]:min-h-11" onSubmit={event => {
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
        <p className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">Microsoft Outlook <span aria-hidden="true">·</span> {environment === 'homologacao' ? 'Homologação' : 'Produção'} <span aria-hidden="true">·</span> Credencial deste fundo</p>
        <label className="block space-y-2">Nome da credencial<Input name="name" required minLength={2} maxLength={120} autoComplete="off" placeholder="Ex.: Outlook — recebimento de notas" /></label>
        <fieldset disabled={pending} className="space-y-4 rounded-xl border p-4"><legend className="px-1 text-sm font-semibold">Dados da aplicação Microsoft</legend>
          <label className="block space-y-2">Identificador da organização (Tenant ID)<Input name="tenantId" required autoComplete="off" pattern={'[a-fA-F0-9\\-]{36}'} aria-describedby="credential-tenant-help" /></label><p id="credential-tenant-help" className="-mt-2 text-xs text-muted-foreground">Identifica a organização no Microsoft Entra.</p>
          <label className="block space-y-2">Identificador da aplicação (Client ID)<Input name="clientId" required autoComplete="off" pattern={'[a-fA-F0-9\\-]{36}'} aria-describedby="credential-client-help" /></label><p id="credential-client-help" className="-mt-2 text-xs text-muted-foreground">Use o ID da aplicação registrada para acessar o Outlook.</p>
          <label className="block space-y-2">Segredo da aplicação<Input name="clientSecret" type="password" required maxLength={8192} autoComplete="new-password" aria-describedby="credential-secret-help" /></label>
          <p id="credential-secret-help" className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Informe o valor do segredo. Ele será criptografado no cofre e não será exibido novamente.</p>
        </fieldset>
        <div className="space-y-3 rounded-xl bg-muted/30 p-4"><p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-primary" aria-hidden="true" />Confirme com seu autenticador</p><label className="block max-w-xs space-y-2">Código de confirmação MFA<Input name="mfaCode" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" placeholder="6 dígitos" /></label></div>
        {message && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{message}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button className="min-h-11 px-4" type="button" variant="outline" disabled={pending} onClick={onClose}>Cancelar</Button><Button className="min-h-11 px-4" type="submit" disabled={pending}><ShieldCheck aria-hidden="true" />{pending ? 'Protegendo credencial…' : 'Salvar credencial'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}
