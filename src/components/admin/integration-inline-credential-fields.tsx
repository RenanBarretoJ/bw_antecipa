'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Sem form aninhado e sem estado persistido: trocar provedor/ambiente ou
// cancelar desmonta estes inputs e descarta os segredos.
export function InlineCredentialFields({ defaultName, pending, onCancel }: {
  defaultName: string; pending: boolean; onCancel: () => void
}) {
  return <div className="grid gap-3 md:grid-cols-2">
    <p className="text-sm text-muted-foreground md:col-span-2">A nova credencial sera guardada com o rascunho. A anterior continua em uso ate publicar. Os segredos nao serao reexibidos.</p>
    <label className="space-y-1"><Label>Nome da credencial</Label><Input name="credentialName" defaultValue={defaultName} required minLength={2} maxLength={120} /></label>
    <label className="space-y-1"><Label>Usuario</Label><Input name="usuario" required maxLength={300} autoComplete="off" /></label>
    <label className="space-y-1"><Label>Senha</Label><Input name="senha" type="password" required maxLength={1000} autoComplete="new-password" /></label>
    <label className="space-y-1"><Label>Codigo TOTP</Label><Input name="mfaCode" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" /></label>
    <div className="md:col-span-2"><Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Cancelar alteracao da credencial</Button></div>
  </div>
}
