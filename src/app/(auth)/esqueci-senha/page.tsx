'use client'

import { useActionState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Mail, ShieldCheck } from 'lucide-react'
import { solicitarRedefinicaoSenha, type PasswordActionState } from '@/app/actions/password'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNotifications } from '@/components/notifications/notification-provider'

export default function EsqueciSenhaPage() {
  const notifications = useNotifications()
  const [state, formAction, pending] = useActionState<PasswordActionState | undefined, FormData>(solicitarRedefinicaoSenha, undefined)

  useEffect(() => {
    if (state?.message) notifications.fromActionResult(state)
  }, [notifications, state])

  return (
    <main className="grid min-h-screen grid-cols-1 bg-[#125dcc] text-white lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-[#f1f1f1] text-[#111] lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)', backgroundSize: '32px 32px' }} />
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl border border-black/20 bg-[#d0d0d0] text-base font-bold">BW</div>
          <div className="leading-tight"><p className="text-lg font-semibold tracking-tight">Antecipa</p><p className="text-xs text-black/60">BETTER WITH</p></div>
        </div>
        <div className="relative z-10 max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#125dcc]">Recuperacao segura</p>
          <h1 className="mt-3 text-pretty text-4xl font-bold leading-tight tracking-tight xl:text-5xl">Recupere o acesso sem enfraquecer o MFA</h1>
          <p className="mt-5 text-sm leading-relaxed text-black/65">Enviaremos um link seguro para redefinir a senha. Depois disso, o segundo fator continua obrigatorio quando configurado.</p>
        </div>
        <p className="relative z-10 flex items-center gap-2 text-xs text-black/55"><ShieldCheck size={15} /> 2024-2026 BETTER WITH. Todos os direitos reservados.</p>
      </section>

      <section className="flex min-h-screen items-center justify-center bg-[#125dcc] px-6 py-12 sm:px-12 lg:px-16">
        <div className="w-full max-w-[448px]">
          <Link href="/login" className="mb-8 inline-flex items-center gap-2 text-sm text-white/75 hover:text-white"><ArrowLeft size={16} /> Voltar ao login</Link>
          <div className="mb-8">
            <h2 className="text-3xl font-bold tracking-tight">Esqueci minha senha</h2>
            <p className="mt-2 text-sm text-white/70">Informe seu e-mail para receber as instrucoes de redefinicao.</p>
          </div>

          <form action={formAction} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-white">E-mail</Label>
              <div className="relative">
                <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black" />
                <Input id="email" name="email" type="email" autoComplete="email" required placeholder="voce@empresa.com.br" className="h-10 border-white/30 bg-white/10 pl-10 text-white placeholder:text-white/65 focus-visible:border-white/60 focus-visible:ring-white/25" />
              </div>
            </div>
            <Button type="submit" disabled={pending} className="h-10 w-full bg-white text-sm font-semibold text-black hover:bg-white/90" size="lg">
              {pending ? <><Loader2 size={17} className="animate-spin" /> Enviando...</> : 'Enviar instrucoes'}
            </Button>
          </form>

          {state?.success && (
            <div className="mt-6 rounded-xl border border-white/20 bg-white/10 p-4 text-sm text-white/80">
              {state.message}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
