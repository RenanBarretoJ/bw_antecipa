import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { GestorInvitePasswordForm } from '@/components/auth/gestor-invite-password-form'
import { obterFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import {
  isGestorInviteErrorCode,
  isGestorInviteToken,
  mensagemConviteGestor,
  type GestorInviteErrorCode,
} from '@/lib/auth/gestor-invite'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: 'Convite de acesso | BW Antecipa',
  robots: { index: false, follow: false },
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function ConviteGestorPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const tokenHash = typeof params.token_hash === 'string' ? params.token_hash : ''
  const type = typeof params.type === 'string' ? params.type : ''
  const rawError = typeof params.error_code === 'string' ? params.error_code : null
  const errorCode: GestorInviteErrorCode | null = isGestorInviteErrorCode(rawError) ? rawError : null
  const role = params.role === 'super_admin' ? 'super_admin' : 'gestor'
  const title = role === 'super_admin' ? 'Ativar conta Super Admin' : 'Ativar conta Gestor'
  const passwordError = params.password_error === 'invalid'
    ? 'A senha nao atende aos requisitos ou a confirmacao nao confere.'
    : null
  const completionError = params.completion_error === 'true'
    ? 'Nao foi possivel concluir a ativacao. Revise a senha e tente novamente.'
    : null

  if (errorCode) return <ConviteShell title={title}><EstadoErro code={errorCode} /></ConviteShell>

  if (tokenHash || type) {
    if (!isGestorInviteToken(tokenHash) || type !== 'invite') {
      return <ConviteShell title={title}><EstadoErro code="AUTH_TOKEN_INVALID" /></ConviteShell>
    }
    return (
      <ConviteShell title={title}>
        <p className="mt-5 text-sm leading-6 text-white/75">
          Defina sua senha. Ao continuar, o convite sera confirmado e o MFA permanecera obrigatorio antes do acesso ao portal.
        </p>
        <GestorInvitePasswordForm
          confirmation={{ tokenHash, role }}
          initialError={passwordError}
        />
      </ConviteShell>
    )
  }

  const fluxo = await obterFluxoAutenticacao()
  if (fluxo !== 'gestor_invite') return <ConviteShell title={title}><EstadoErro code="AUTH_TOKEN_INVALID" /></ConviteShell>

  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return <ConviteShell title={title}><EstadoErro code="AUTH_TOKEN_INVALID" /></ConviteShell>

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || !['gestor', 'super_admin'].includes(profile.role)) {
    return <ConviteShell title={title}><EstadoErro code="PROFILE_INVALID" /></ConviteShell>
  }
  const statusEsperado = profile.role === 'gestor' ? 'inativo' : 'ativo'
  if (profile.status !== statusEsperado) return <ConviteShell title={title}><EstadoErro code="CONVITE_GESTOR_CANCELADO" /></ConviteShell>

  return (
    <ConviteShell title={profile.role === 'super_admin' ? 'Ativar conta Super Admin' : 'Ativar conta Gestor'}>
      <p className="mt-5 text-sm leading-6 text-white/75">
        O convite foi confirmado. Defina novamente a senha para retomar a conclusao do acesso.
      </p>
      <GestorInvitePasswordForm initialError={completionError} />
    </ConviteShell>
  )
}

function EstadoErro({ code }: { code: GestorInviteErrorCode }) {
  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-xl border border-red-300/40 bg-red-300/10 p-4 text-sm text-red-100">
        {mensagemConviteGestor(code)}
      </div>
      <Link href="/login" className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black hover:bg-white/90">Voltar ao login</Link>
    </div>
  )
}

function ConviteShell({ children, title }: { children: ReactNode; title: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#125dcc] px-6 py-10 text-white">
      <section className="w-full max-w-lg rounded-2xl border border-white/20 bg-white/10 p-7 shadow-xl backdrop-blur sm:p-9">
        <Link href="/login" className="mb-6 inline-flex items-center gap-2 text-sm text-white/75 hover:text-white"><ArrowLeft size={16} /> Voltar ao login</Link>
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-xl bg-white text-[#125dcc]"><ShieldCheck size={24} /></div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Convite de acesso</p>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          </div>
        </div>
        {children}
      </section>
    </main>
  )
}
