'use client'

import { Suspense, useActionState, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import { abortarFluxoRecuperacaoSenha, concluirRedefinicaoSenha, iniciarSessaoRecuperacaoSenha, verificarProntidaoRedefinicaoSenha, type PasswordActionState } from '@/app/actions/password'
import { avaliarForcaSenha } from '@/lib/auth/password'
import { deveProcessarCodigoPkce, recoveryFlowLogShape, sanitizarCodigoErroRecuperacao } from '@/lib/auth/password-recovery'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNotifications } from '@/components/notifications/notification-provider'

type PageState = 'validating' | 'ready' | 'invalid' | 'requires_mfa'

export default function RedefinirSenhaPage() {
  return (
    <Suspense fallback={<ResetPasswordShell message="Validando link de recuperacao..." />}>
      <RedefinirSenhaContent />
    </Suspense>
  )
}

function RedefinirSenhaContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const notifications = useNotifications()
  const [pageState, setPageState] = useState<PageState>('validating')
  const [message, setMessage] = useState('Validando link de recuperacao...')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [state, formAction, pending] = useActionState<PasswordActionState | undefined, FormData>(concluirRedefinicaoSenha, undefined)

  const strength = useMemo(() => avaliarForcaSenha(password), [password])

  useEffect(() => {
    let mounted = true

    async function validate() {
      const supabase = createClient()
      const code = searchParams.get('code')
      const error = searchParams.get('error') || searchParams.get('error_code')
      const errorCode = searchParams.get('error_code')
      const pkceStorageKey = code ? `bw-password-recovery-code:${code}` : null
      const alreadyProcessed = pkceStorageKey ? window.sessionStorage.getItem(pkceStorageKey) === '1' : false

      console.info('[password-recovery][page]', recoveryFlowLogShape({
        hasCode: !!code,
        errorCode: errorCode || error,
        next: '/redefinir-senha',
      }))

      if (error) {
        await Promise.allSettled([
          supabase.auth.signOut({ scope: 'local' }),
          abortarFluxoRecuperacaoSenha(sanitizarCodigoErroRecuperacao(errorCode || error)),
        ])
        if (!mounted) return
        setPageState('invalid')
        setMessage('O link expirou ou ja foi utilizado.')
        return
      }

      if (code && alreadyProcessed) {
        window.setTimeout(() => router.replace('/redefinir-senha'), 500)
        return
      }

      if (deveProcessarCodigoPkce({ code, error, errorCode, alreadyProcessed })) {
        if (pkceStorageKey) window.sessionStorage.setItem(pkceStorageKey, '1')
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code!)
        if (exchangeError) {
          await Promise.allSettled([
            supabase.auth.signOut({ scope: 'local' }),
            abortarFluxoRecuperacaoSenha(sanitizarCodigoErroRecuperacao(exchangeError.code || 'exchange_failed')),
          ])
          if (!mounted) return
          setPageState('invalid')
          setMessage('O link expirou ou ja foi utilizado.')
          return
        }
        const recovery = await iniciarSessaoRecuperacaoSenha()
        if (!recovery.success) {
          if (!mounted) return
          setPageState('invalid')
          setMessage(recovery.message)
          return
        }
        router.replace('/redefinir-senha')
      }

      const readiness = await verificarProntidaoRedefinicaoSenha()
      if (!mounted) return
      if (readiness.success) {
        setPageState('ready')
        setMessage('')
      } else if (readiness.requiresMfa) {
        setPageState('requires_mfa')
        setMessage(readiness.message)
      } else {
        setPageState('invalid')
        setMessage(readiness.message)
      }
    }

    void validate()
    return () => { mounted = false }
  }, [router, searchParams])

  useEffect(() => {
    if (!state?.message) return
    notifications.fromActionResult(state)
    if (state.redirectTo) router.replace(state.redirectTo)
  }, [notifications, router, state])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#125dcc] px-6 py-10 text-white">
      <section className="w-full max-w-lg rounded-2xl border border-white/20 bg-white/10 p-6 shadow-xl backdrop-blur sm:p-8">
        <Link href="/login" className="mb-6 inline-flex items-center gap-2 text-sm text-white/75 hover:text-white"><ArrowLeft size={16} /> Voltar ao login</Link>
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-white text-[#125dcc]"><ShieldCheck size={22} /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Recuperacao de senha</p>
            <h1 className="text-2xl font-bold tracking-tight">Defina uma nova senha</h1>
          </div>
        </div>
        <p className="mt-4 text-sm text-white/70">A senha sera atualizada pela sessao temporaria do Supabase e o MFA continuara obrigatorio.</p>

        {pageState === 'validating' && <div className="mt-6 flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 p-4 text-sm text-white/75"><Loader2 className="animate-spin" size={16} /> {message}</div>}

        {pageState === 'invalid' && (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-red-300/40 bg-red-300/10 p-4 text-sm text-red-100">{message}</div>
            <button type="button" onClick={async () => {
              const supabase = createClient()
              await Promise.allSettled([
                supabase.auth.signOut({ scope: 'local' }),
                abortarFluxoRecuperacaoSenha('solicitar_novo_link'),
              ])
              router.replace('/esqueci-senha?motivo=link_expirado')
            }} className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-white px-3 text-sm font-semibold text-black hover:bg-white/90">Solicitar novo link</button>
          </div>
        )}

        {pageState === 'requires_mfa' && (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-4 text-sm text-amber-100">{message}</div>
            <Link href="/mfa/desafio?next=/redefinir-senha" className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-white px-3 text-sm font-semibold text-black hover:bg-white/90">Confirmar MFA</Link>
          </div>
        )}

        {pageState === 'ready' && (
          <form action={formAction} className="mt-6 space-y-5">
            <PasswordInput id="password" name="password" label="Nova senha" value={password} onChange={setPassword} show={showPassword} setShow={setShowPassword} autoComplete="new-password" />
            <PasswordInput id="confirmPassword" name="confirmPassword" label="Confirmar senha" show={showConfirm} setShow={setShowConfirm} autoComplete="new-password" />

            <div className="rounded-xl border border-white/20 bg-white/10 p-4">
              <div className="mb-3 h-2 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-white transition-all" style={{ width: `${(strength.score / 5) * 100}%` }} />
              </div>
              <div className="grid gap-2 text-xs text-white/75 sm:grid-cols-2">
                {strength.checks.map((check) => (
                  <span key={check.key} className="inline-flex items-center gap-2">
                    {check.valid ? <CheckCircle2 size={14} className="text-emerald-200" /> : <XCircle size={14} className="text-white/40" />}
                    {check.label}
                  </span>
                ))}
              </div>
            </div>

            {state?.errors && <div className="rounded-xl border border-red-300/40 bg-red-300/10 p-4 text-sm text-red-100">{Object.values(state.errors).flat().join(' ')}</div>}
            <Button type="submit" disabled={pending} className="h-10 w-full bg-white text-black hover:bg-white/90">
              {pending ? <><Loader2 size={16} className="animate-spin" /> Atualizando...</> : 'Redefinir senha'}
            </Button>
          </form>
        )}
      </section>
    </main>
  )
}

function ResetPasswordShell({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#125dcc] px-6 py-10 text-white">
      <section className="w-full max-w-lg rounded-2xl border border-white/20 bg-white/10 p-6 shadow-xl backdrop-blur sm:p-8">
        <div className="flex items-center gap-2 text-sm text-white/75"><Loader2 className="animate-spin" size={16} /> {message}</div>
      </section>
    </main>
  )
}

function PasswordInput({ id, name, label, show, setShow, value, onChange, autoComplete }: {
  id: string
  name: string
  label: string
  show: boolean
  setShow: (value: boolean) => void
  value?: string
  onChange?: (value: string) => void
  autoComplete?: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm text-white">{label}</Label>
      <div className="relative">
        <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black" />
        <Input id={id} name={name} type={show ? 'text' : 'password'} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined} autoComplete={autoComplete} required className="h-10 border-white/30 bg-white/10 pl-10 pr-10 text-white placeholder:text-white/65 focus-visible:border-white/60 focus-visible:ring-white/25" />
        <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-black transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  )
}
