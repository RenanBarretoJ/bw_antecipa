'use client'

import { useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import { ShieldCheck, Copy, Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { confirmarConfiguracaoMfa, iniciarConfiguracaoMfa, redirecionarAposMfa, type MfaActionState } from '@/app/actions/mfa'

type Enrollment = { factorId: string; qrCode: string; secret: string; uri: string }

export default function MfaSetupPage() {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [loading, setLoading] = useState(true)
  const [setupError, setSetupError] = useState('')
  const [state, formAction, pending] = useActionState<MfaActionState<{ recoveryCodes: string[] }> | undefined, FormData>(confirmarConfiguracaoMfa, undefined)

  useEffect(() => {
    let mounted = true
    async function start() {
      const result = await iniciarConfiguracaoMfa()
      if (!mounted) return
      if (result.success && result.data) setEnrollment(result.data)
      else setSetupError(result.message)
      setLoading(false)
    }
    void start()
    return () => { mounted = false }
  }, [])

  function downloadCodes() {
    const codes = state?.data?.recoveryCodes || []
    const blob = new Blob([`BW Antecipa - codigos de recuperacao MFA\n\n${codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'bw-antecipa-codigos-recuperacao.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <section className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck size={22} /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Seguranca obrigatoria</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">Configure MFA por aplicativo autenticador</h1>
            <p className="mt-2 text-sm text-muted-foreground">Use Google Authenticator, Microsoft Authenticator, Authy, 1Password ou outro app TOTP. O codigo tem 6 digitos e renova a cada 30 segundos.</p>
          </div>
        </div>

        {loading && <div className="mt-8 flex items-center gap-3 rounded-xl border border-border bg-background p-4 text-sm text-muted-foreground"><Loader2 className="animate-spin" size={18} /> Gerando fator seguro...</div>}
        {setupError && <div className="mt-8 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{setupError}</div>}

        {state?.success && state.data?.recoveryCodes ? (
          <div className="mt-8 space-y-4">
            <div className="rounded-xl border border-success/30 bg-success/10 p-4">
              <p className="font-semibold text-success-foreground">MFA ativado com sucesso.</p>
              <p className="mt-1 text-sm text-muted-foreground">Guarde estes codigos agora. Eles nao serao exibidos novamente e cada codigo so pode ser usado uma vez.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {state.data.recoveryCodes.map((code) => <code key={code} className="rounded-lg border border-border bg-background px-3 py-2 text-center font-mono text-sm">{code}</code>)}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(state.data?.recoveryCodes.join('\n') || '')}><Copy size={16} /> Copiar</Button>
              <Button type="button" variant="outline" onClick={downloadCodes}><Download size={16} /> Baixar</Button>
              <form action={redirecionarAposMfa}><Button type="submit">Continuar para o portal</Button></form>
            </div>
          </div>
        ) : enrollment ? (
          <form action={formAction} className="mt-8 space-y-5">
            <input type="hidden" name="factorId" value={enrollment.factorId} />
            <div className="grid gap-5 md:grid-cols-[220px_1fr]">
              <div className="rounded-xl border border-border bg-background p-4">
                {enrollment.qrCode.startsWith('<svg') ? (
                  <div className="rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: enrollment.qrCode }} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="QR Code MFA" src={enrollment.qrCode} className="rounded-lg bg-white p-2" />
                )}
              </div>
              <div className="space-y-4">
                <div>
                  <Label>Chave manual</Label>
                  <div className="mt-2 rounded-lg border border-border bg-background p-3 font-mono text-sm break-all">{enrollment.secret}</div>
                  <p className="mt-2 text-xs text-muted-foreground">Esta chave so aparece durante a configuracao. Nao salve em local compartilhado.</p>
                </div>
                <div>
                  <Label htmlFor="code">Codigo de 6 digitos</Label>
                  <Input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="000000" className="mt-2 h-11 font-mono tracking-[0.4em]" required />
                </div>
              </div>
            </div>
            {state?.message && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{state.message}</div>}
            <Button type="submit" disabled={pending}>{pending ? <><Loader2 className="animate-spin" size={16} /> Validando...</> : 'Ativar MFA'}</Button>
          </form>
        ) : null}

        <p className="mt-8 text-xs text-muted-foreground">Se voce nao deveria configurar MFA neste momento, <Link href="/login" className="text-primary underline">saia e entre novamente</Link>.</p>
      </section>
    </main>
  )
}
