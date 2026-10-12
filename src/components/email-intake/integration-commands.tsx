'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, PlugZap, Power } from 'lucide-react'
import { alterarAtivacaoEmail, testarIntegracaoEmail } from '@/app/actions/email-operations'
import { activationMissing, type EmailIntegration } from '@/lib/email-intake/operations/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmailSyncButton } from './sync-button'

export function EmailIntegrationCommands({ fundoId, row }: { fundoId: string; row: EmailIntegration }) {
  const router = useRouter(), [pending, start] = useTransition(), [action, setAction] = useState<'test' | 'enable' | 'disable' | null>(null)
  const [message, setMessage] = useState(''), [confirmed, setConfirmed] = useState(false)
  const missing = activationMissing(row)
  function choose(next: typeof action) { setAction(next); setConfirmed(false); setMessage('') }
  return <section className="space-y-4 border-t pt-4" aria-label="Ações da integração">
    <div><h3 className="font-semibold">Conexão e leitura automática</h3><p className="mt-1 text-sm text-muted-foreground">Teste o acesso à caixa antes de iniciar a importação dos documentos.</p></div>
    {!row.enabled && <div className="rounded-xl border bg-muted/20 p-4 text-sm"><h4 className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4 text-primary" aria-hidden="true" />Antes de ativar</h4>
      {missing.length ? <ul className="mt-2 list-disc space-y-1 pl-5">{missing.map(item => <li key={item}>{item}</li>)}</ul>
        : <p className="mt-2">✓ Credencial selecionada · ✓ Caixa acessível · ✓ Cedentes configurados · ✓ Data inicial definida · ✓ Teste aprovado</p>}</div>}
    <div className="flex flex-wrap items-start gap-3">
      <Button className="min-h-11 px-4" variant="outline" disabled={!row.credentialId || !row.mailbox || !row.mailboxObjectId || pending} onClick={() => choose('test')}><PlugZap aria-hidden="true" />Testar conexão</Button>
      <EmailSyncButton integrationId={row.id} disabled={!row.enabled || Boolean(row.health?.blockedModes.length)} />
      <Button className="min-h-11 px-4" variant={row.enabled ? 'outline' : 'default'} disabled={pending || (!row.enabled && missing.length > 0)} onClick={() => choose(row.enabled ? 'disable' : 'enable')}><Power aria-hidden="true" />{row.enabled ? 'Desativar integração' : 'Ativar integração'}</Button>
    </div>
    {action && <form className="space-y-3 rounded-lg border bg-muted/30 p-4" onSubmit={event => {
      event.preventDefault()
      const form = event.currentTarget, code = String(new FormData(form).get('mfaCode') ?? '')
      start(async () => {
        const input = { fundoId, id: row.id, revision: row.revision, mfaCode: code }
        const result = action === 'test' ? await testarIntegracaoEmail(input) : await alterarAtivacaoEmail({ ...input, enabled: action === 'enable', scopeConfirmed: confirmed })
        form.reset()
        setMessage(result.ok ? action === 'test' ? 'Conexão validada. A caixa está acessível.' : action === 'enable' ? 'Integração ativada. A leitura ocorrerá em segundo plano.' : 'Integração desativada. O histórico foi preservado.' : result.message)
        if (result.ok) { setAction(null); router.refresh() }
      })
    }}>
      <p className="font-medium">{action === 'test' ? 'Validar o acesso à caixa' : action === 'enable' ? 'Confirmar ativação' : 'Confirmar desativação'}</p>
      <p className="text-sm text-muted-foreground">{action === 'test' ? 'O teste consulta o acesso à caixa, sem importar documentos ou iniciar a leitura automática.' : action === 'enable' ? 'A integração começará a considerar os e-mails a partir da data inicial salva.' : 'Novas leituras serão interrompidas. Processamentos já iniciados poderão concluir.'}</p>
      {action !== 'test' && <label className="flex items-start gap-2"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1" /><span className="text-sm">{action === 'enable' ? 'Confirmo a configuração e que o administrador Microsoft restringiu esta aplicação às caixas autorizadas.' : 'Confirmo a interrupção de novas leituras desta integração.'}</span></label>}
      <label className="block max-w-xs space-y-1">Código de confirmação MFA<Input name="mfaCode" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" autoFocus /></label>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending}>{pending ? action === 'test' ? 'Testando acesso à caixa de e-mail…' : 'Confirmando…' : 'Confirmar'}</Button><Button type="button" variant="outline" disabled={pending} onClick={() => choose(null)}>Cancelar</Button></div>
    </form>}
    {message && <p className="text-sm" role="status">{message}</p>}
  </section>
}
