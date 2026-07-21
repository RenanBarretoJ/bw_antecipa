'use client'

import { useActionState } from 'react'
import { signup } from '@/app/actions/auth'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { CheckCircle, Eye, KeyRound, Mail, ShieldCheck, TrendingUp, User, Zap, Loader2 } from 'lucide-react'

export default function CadastroPage() {
  const [state, formAction, pending] = useActionState(signup, undefined)
  const isSuccess = state?.message?.includes('sucesso')

  return (
    <main className="grid min-h-screen grid-cols-1 bg-[#125dcc] text-white lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-[#f1f1f1] text-[#111] lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)', backgroundSize: '32px 32px' }} />
        <div className="relative z-10 flex items-center gap-3"><div className="flex size-11 items-center justify-center rounded-xl border border-black/20 bg-[#d0d0d0] text-base font-bold">BW</div><div className="leading-tight"><p className="text-lg font-semibold tracking-tight">Antecipa</p><p className="text-xs text-black/60">BW BI LTDA</p></div></div>
        <div className="relative z-10 max-w-xl"><h1 className="text-pretty text-4xl font-bold leading-tight tracking-tight xl:text-5xl">Comece a antecipar seus recebíveis hoje mesmo</h1><ul className="mt-10 space-y-6">{[{ icon: Zap, title: 'Cadastro rápido', description: 'Crie sua conta em poucos minutos.' }, { icon: ShieldCheck, title: 'Dados protegidos', description: 'Criptografia de ponta a ponta.' }, { icon: TrendingUp, title: 'Aprovação ágil', description: 'Análise e aprovação em até 24h.' }].map(({ icon: Icon, title, description }) => <li key={title} className="flex items-start gap-4"><span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border border-black/20 bg-black/5"><Icon size={20} /></span><span><p className="font-semibold">{title}</p><p className="text-sm leading-relaxed text-black/60">{description}</p></span></li>)}</ul></div>
        <p className="relative z-10 flex items-center gap-2 text-xs text-black/55"><ShieldCheck size={15} /> 2024–2026 BW BI LTDA. Todos os direitos reservados.</p>
      </section>

      <section className="flex min-h-screen items-center justify-center bg-[#125dcc] px-6 py-12 sm:px-12 lg:px-16"><div className="w-full max-w-[448px]"><div className="mb-10 flex items-center gap-3 lg:hidden"><div className="flex size-10 items-center justify-center rounded-xl bg-white text-sm font-bold text-black">BW</div><div className="leading-tight"><p className="font-semibold tracking-tight">Antecipa</p><p className="text-xs text-white/55">BW BI LTDA</p></div></div><div className="mb-8"><h2 className="text-3xl font-bold tracking-tight">Criar nova conta</h2><p className="mt-2 text-sm text-white/60">Preencha os dados abaixo para começar.</p></div>
        {isSuccess ? <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-8 text-center"><div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-emerald-400/15"><CheckCircle size={28} className="text-emerald-300" /></div><p className="mb-1 text-lg font-semibold text-emerald-200">Conta criada com sucesso!</p><p className="mb-6 text-sm text-emerald-200/75">{state?.message}</p><Link href="/login"><Button className="bg-white text-black hover:bg-white/90">Fazer login</Button></Link></div> : <form action={formAction} className="space-y-5">
          <div className="space-y-2"><Label htmlFor="nome_completo" className="text-sm text-white">Nome completo</Label><div className="relative"><User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/45" /><Input id="nome_completo" name="nome_completo" type="text" required placeholder="Digite seu nome completo" className="h-10 border-white/15 bg-transparent pl-10 text-white placeholder:text-white/35 focus-visible:border-white/40 focus-visible:ring-white/20" aria-invalid={!!state?.errors?.nome_completo} /></div>{state?.errors?.nome_completo && <p className="text-sm text-red-300">{state.errors.nome_completo[0]}</p>}</div>
          <div className="space-y-2"><Label htmlFor="email" className="text-sm text-white">E-mail</Label><div className="relative"><Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black" /><Input id="email" name="email" type="email" autoComplete="email" required placeholder="voce@empresa.com.br" className="h-10 border-white/30 bg-white/10 pl-10 text-white placeholder:text-white/65 focus-visible:border-white/60 focus-visible:ring-white/25" aria-invalid={!!state?.errors?.email} /></div>{state?.errors?.email && <p className="text-sm text-red-200">{state.errors.email[0]}</p>}</div>
          <div className="space-y-2"><Label htmlFor="password" className="text-sm text-white">Senha</Label><div className="relative"><KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black" /><Input id="password" name="password" type="password" required placeholder="Mínimo 8 caracteres" className="h-10 border-white/30 bg-white/10 pl-10 pr-10 text-white placeholder:text-white/65 focus-visible:border-white/60 focus-visible:ring-white/25" aria-invalid={!!state?.errors?.password} /><Eye size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-black" /></div>{state?.errors?.password && <div className="space-y-1">{state.errors.password.map((error) => <p key={error} className="text-sm text-red-200">{error}</p>)}</div>}</div>
          <div className="space-y-2"><Label htmlFor="confirmPassword" className="text-sm text-white">Confirmar senha</Label><div className="relative"><KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black" /><Input id="confirmPassword" name="confirmPassword" type="password" required placeholder="Repita a senha" className="h-10 border-white/30 bg-white/10 pl-10 pr-10 text-white placeholder:text-white/65 focus-visible:border-white/60 focus-visible:ring-white/25" aria-invalid={!!state?.errors?.confirmPassword} /><Eye size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-black" /></div>{state?.errors?.confirmPassword && <p className="text-sm text-red-200">{state.errors.confirmPassword[0]}</p>}</div>
          {state?.message && <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{state.message}</div>}
          <Button type="submit" disabled={pending} className="h-10 w-full bg-white text-sm font-semibold text-black hover:bg-white/90" size="lg">{pending ? <><Loader2 size={17} className="animate-spin" /> Criando conta...</> : 'Criar conta'}</Button>
        </form>}
        {!isSuccess && <p className="mt-7 text-center text-sm text-white/60">Já tem conta? <Link href="/login" className="font-semibold text-white hover:underline">Fazer login</Link></p>}
      </div></section>
    </main>
  )
}
