'use client'

import { Suspense, useActionState, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { aceitarConviteNovoCedente, type AceiteConviteCedenteState } from '@/app/actions/convite-cedente'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNotifications } from '@/components/notifications/notification-provider'

export default function ConviteCedentePage() {
  return <Suspense fallback={<ConviteShell />}><ConviteCedenteContent /></Suspense>
}

function ConviteCedenteContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const notifications = useNotifications()
  const token = searchParams.get('token') || ''
  const errorCode = searchParams.get('error_code')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [state, formAction, pending] = useActionState<AceiteConviteCedenteState, FormData>(aceitarConviteNovoCedente, undefined)
  const linkValido = /^[0-9a-f]{64}$/i.test(token) && !errorCode

  useEffect(() => {
    if (!state?.message) return
    notifications.fromActionResult(state)
    if (state.success && state.redirectTo) router.replace(state.redirectTo)
  }, [notifications, router, state])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#125dcc] px-6 py-10 text-white">
      <section className="w-full max-w-lg rounded-2xl border border-white/20 bg-white/10 p-7 shadow-xl backdrop-blur sm:p-9">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-xl bg-white text-[#125dcc]"><ShieldCheck size={24} /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Convite de acesso</p>
            <h1 className="text-2xl font-bold tracking-tight">Ativar conta Cedente</h1>
          </div>
        </div>

        {!linkValido ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-red-300/40 bg-red-300/10 p-4 text-sm text-red-100">
              O convite e invalido, expirou ou ja foi utilizado. Solicite um novo convite ao gestor do fundo.
            </div>
            <Link href="/login" className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black hover:bg-white/90">Voltar ao login</Link>
          </div>
        ) : (
          <form action={formAction} className="mt-6 space-y-5">
            <input type="hidden" name="token" value={token} />
            <p className="text-sm leading-6 text-white/75">Defina sua senha. Depois do aceite, o Cedente sera criado com o fundo do convite e voce completara os dados cadastrais.</p>
            <PasswordField id="invite-password" name="password" label="Senha" show={showPassword} onToggle={() => setShowPassword((value) => !value)} />
            <PasswordField id="invite-confirm-password" name="confirmPassword" label="Confirmar senha" show={showConfirm} onToggle={() => setShowConfirm((value) => !value)} />
            {state?.errors && <div className="rounded-xl border border-red-300/40 bg-red-300/10 p-3 text-sm text-red-100">{Object.values(state.errors).flat().join(' ')}</div>}
            <Button type="submit" disabled={pending} className="h-10 w-full bg-white text-black hover:bg-white/90">
              {pending ? <><Loader2 className="size-4 animate-spin" /> Ativando...</> : 'Aceitar convite e continuar'}
            </Button>
          </form>
        )}
      </section>
    </main>
  )
}

function PasswordField({ id, name, label, show, onToggle }: { id: string; name: string; label: string; show: boolean; onToggle: () => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-white">{label}</Label>
      <div className="relative">
        <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black" />
        <Input id={id} name={name} type={show ? 'text' : 'password'} autoComplete="new-password" required className="border-white/30 bg-white/10 pl-10 pr-10 text-white" />
        <button type="button" onClick={onToggle} className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-black hover:bg-white/20" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  )
}

function ConviteShell() {
  return <main className="flex min-h-screen items-center justify-center bg-[#125dcc] text-white"><Loader2 className="size-6 animate-spin" aria-label="Carregando convite" /></main>
}
