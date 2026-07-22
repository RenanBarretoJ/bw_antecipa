'use client'

import { useActionState, useEffect, useState } from 'react'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { logout } from '@/app/actions/auth'
import { listarFatoresMfa, redirecionarAposMfa, usarCodigoRecuperacaoMfa, verificarDesafioMfa, type MfaActionState } from '@/app/actions/mfa'

type Factor = { id: string; friendlyName: string; status: string }

export default function MfaChallengePage() {
  const [factors, setFactors] = useState<Factor[]>([])
  const [loading, setLoading] = useState(true)
  const [loadMessage, setLoadMessage] = useState('')
  const [state, formAction, pending] = useActionState<MfaActionState | undefined, FormData>(verificarDesafioMfa, undefined)
  const [recoveryState, recoveryAction, recoveryPending] = useActionState<MfaActionState | undefined, FormData>(usarCodigoRecuperacaoMfa, undefined)

  useEffect(() => {
    let mounted = true
    async function load() {
      const result = await listarFatoresMfa()
      if (!mounted) return
      if (result.success && result.data) setFactors(result.data.fatores)
      else setLoadMessage(result.message)
      setLoading(false)
    }
    void load()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (state?.success || recoveryState?.success) void redirecionarAposMfa()
  }, [state?.success, recoveryState?.success])

  const selectedFactor = factors[0]

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><ShieldCheck size={22} /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">MFA</p>
            <h1 className="text-2xl font-bold tracking-tight">Confirme seu acesso</h1>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Informe o codigo de 6 digitos do seu aplicativo autenticador para elevar a sessao.</p>

        {loading && <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" size={16} /> Carregando fator...</div>}
        {loadMessage && <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{loadMessage}</div>}

        {selectedFactor ? (
          <form action={formAction} className="mt-6 space-y-4">
            <input type="hidden" name="factorId" value={selectedFactor.id} />
            <div>
              <Label htmlFor="code">Codigo TOTP</Label>
              <div className="relative mt-2">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <Input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="000000" className="h-11 pl-10 font-mono tracking-[0.4em]" required />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Fator: {selectedFactor.friendlyName}</p>
            </div>
            {state?.message && <div className={`rounded-lg border p-3 text-sm ${state.success ? 'border-success/30 bg-success/10 text-success-foreground' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}>{state.message}</div>}
            <Button type="submit" disabled={pending} className="w-full">{pending ? <><Loader2 className="animate-spin" size={16} /> Verificando...</> : 'Verificar codigo'}</Button>
          </form>
        ) : !loading ? (
          <div className="mt-6 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning-foreground">Nenhum fator MFA ativo encontrado. Volte para o onboarding de seguranca.</div>
        ) : null}

        <details className="mt-6 rounded-xl border border-border bg-background p-4">
          <summary className="cursor-pointer text-sm font-semibold">Usar codigo de recuperacao</summary>
          <form action={recoveryAction} className="mt-4 space-y-3">
            <Input name="recoveryCode" placeholder="XXXX-XXXX-XXXX" className="font-mono uppercase" required />
            {recoveryState?.message && <p className={`text-sm ${recoveryState.success ? 'text-success-foreground' : 'text-destructive'}`}>{recoveryState.message}</p>}
            <Button type="submit" variant="outline" disabled={recoveryPending} className="w-full">{recoveryPending ? 'Validando...' : 'Validar recuperacao'}</Button>
          </form>
        </details>

        <form action={logout} className="mt-6 text-center">
          <button type="submit" className="text-xs text-primary underline">Sair e entrar com outra conta</button>
        </form>
      </section>
    </main>
  )
}
