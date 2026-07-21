'use client'

import { useActionState, useState, useEffect, useRef } from 'react'
import { login } from '@/app/actions/auth'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Eye, KeyRound, Mail, ShieldCheck, TrendingUp, Zap, Loader2 } from 'lucide-react'

const MAX_ATTEMPTS = 5
const LOCKOUT_DURATION = 15 * 60 * 1000

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, undefined)
  const [attempts, setAttempts] = useState(0)
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null)
  const [lockoutRemaining, setLockoutRemaining] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)
  const isLockedOut = lockoutUntil !== null && Date.now() < lockoutUntil

  useEffect(() => {
    if (!lockoutUntil) return
    const interval = setInterval(() => {
      const remaining = lockoutUntil - Date.now()
      if (remaining <= 0) {
        setLockoutUntil(null)
        setAttempts(0)
        setLockoutRemaining(0)
      } else setLockoutRemaining(Math.ceil(remaining / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [lockoutUntil])

  useEffect(() => {
    if (state?.message && !pending) {
      const newAttempts = attempts + 1
      setAttempts(newAttempts)
      if (newAttempts >= MAX_ATTEMPTS) setLockoutUntil(Date.now() + LOCKOUT_DURATION)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, pending])

  const handleSubmit = (formData: FormData) => {
    if (!isLockedOut) formAction(formData)
  }

  return (
    <main className="grid min-h-screen grid-cols-1 bg-[#125dcc] text-white lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-[#f1f1f1] text-[#111] lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)', backgroundSize: '32px 32px' }} />
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl border border-black/20 bg-[#d0d0d0] text-base font-bold">BW</div>
          <div className="leading-tight"><p className="text-lg font-semibold tracking-tight">Antecipa</p><p className="text-xs text-black/60">BW BI LTDA</p></div>
        </div>
        <div className="relative z-10 max-w-xl">
          <h1 className="text-pretty text-4xl font-bold leading-tight tracking-tight xl:text-5xl">Antecipação de recebíveis com segurança e agilidade</h1>
          <ul className="mt-10 space-y-6">
            {[
              { icon: Zap, title: 'Rápido e digital', description: 'Processo 100% online, do envio ao desembolso.' },
              { icon: ShieldCheck, title: 'Conta escrow segura', description: 'Recursos protegidos em conta vinculada.' },
              { icon: TrendingUp, title: 'Taxas competitivas', description: 'Condições personalizadas para o seu perfil.' },
            ].map(({ icon: Icon, title, description }) => <li key={title} className="flex items-start gap-4"><span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border border-black/20 bg-black/5"><Icon size={20} /></span><span><p className="font-semibold">{title}</p><p className="text-sm leading-relaxed text-black/60">{description}</p></span></li>)}
          </ul>
        </div>
        <p className="relative z-10 flex items-center gap-2 text-xs text-black/55"><ShieldCheck size={15} /> 2024–2026 BW BI LTDA. Todos os direitos reservados.</p>
      </section>

      <section className="flex min-h-screen items-center justify-center bg-[#125dcc] px-6 py-12 sm:px-12 lg:px-16">
        <div className="w-full max-w-[448px]">
          <div className="mb-12 flex items-center gap-3 lg:hidden"><div className="flex size-10 items-center justify-center rounded-xl bg-white text-sm font-bold text-black">BW</div><div className="leading-tight"><p className="font-semibold tracking-tight">Antecipa</p><p className="text-xs text-white/55">BW BI LTDA</p></div></div>
          <div className="mb-8"><h2 className="text-3xl font-bold tracking-tight">Bem-vindo de volta</h2><p className="mt-2 text-sm text-white/60">Entre com suas credenciais para acessar o portal.</p></div>

          {isLockedOut ? <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-5 text-center"><ShieldCheck size={28} className="mx-auto mb-2 text-red-300" /><p className="font-semibold text-red-200">Acesso temporariamente bloqueado</p><p className="mt-1 text-sm text-red-200/75">Muitas tentativas falhas. Tente novamente em <span className="font-mono font-bold">{Math.floor(lockoutRemaining / 60)}:{String(lockoutRemaining % 60).padStart(2, '0')}</span></p></div> : <form ref={formRef} action={handleSubmit} className="space-y-6">
            <div className="space-y-2"><Label htmlFor="email" className="text-sm text-white">E-mail</Label><div className="relative"><Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black" /><Input id="email" name="email" type="email" autoComplete="email" required placeholder="voce@empresa.com.br" className="h-10 border-white/30 bg-white/10 pl-10 text-white placeholder:text-white/65 focus-visible:border-white/60 focus-visible:ring-white/25" aria-invalid={!!state?.errors?.email} /></div>{state?.errors?.email && <p className="text-sm text-red-200">{state.errors.email[0]}</p>}</div>
            <div className="space-y-2"><Label htmlFor="password" className="text-sm text-white">Senha</Label><div className="relative"><KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black" /><Input id="password" name="password" type="password" autoComplete="current-password" required placeholder="Digite sua senha" className="h-10 border-white/30 bg-white/10 pl-10 pr-10 text-white placeholder:text-white/65 focus-visible:border-white/60 focus-visible:ring-white/25" aria-invalid={!!state?.errors?.password} /><Eye size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-black" /></div>{state?.errors?.password && <div className="space-y-1">{state.errors.password.map((error) => <p key={error} className="text-sm text-red-200">{error}</p>)}</div>}</div>
            {state?.message && <div className={`rounded-lg border p-3 text-sm ${state.message.includes('sucesso') ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-red-400/30 bg-red-400/10 text-red-200'}`}>{state.message}</div>}
            {attempts > 0 && attempts < MAX_ATTEMPTS && <p className="rounded-lg bg-amber-400/10 py-2 text-center text-sm text-amber-200">{MAX_ATTEMPTS - attempts} tentativa(s) restante(s)</p>}
            <Button type="submit" disabled={pending || isLockedOut} className="h-10 w-full bg-white text-sm font-semibold text-black hover:bg-white/90" size="lg">{pending ? <><Loader2 size={17} className="animate-spin" /> Entrando...</> : 'Entrar'}</Button>
          </form>}
          <p className="mt-7 text-center text-sm text-white/60">Não tem conta? <Link href="/cadastro" className="font-semibold text-white hover:underline">Cadastre-se</Link></p>
        </div>
      </section>
    </main>
  )
}
