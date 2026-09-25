import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { ConsultorInvitePasswordForm } from '@/components/auth/consultor-invite-password-form'
import { obterFluxoAutenticacao } from '@/lib/auth/auth-flow-server'
import { isConsultorInviteErrorCode, isConsultorInviteToken, mensagemConviteConsultor, type ConsultorInviteErrorCode } from '@/lib/auth/consultor-invite'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Convite de Consultoria | BW Antecipa', robots: { index: false, follow: false } }

export default async function ConviteConsultorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const tokenHash = typeof params.token_hash === 'string' ? params.token_hash : ''
  const type = typeof params.type === 'string' ? params.type : ''
  const rawError = typeof params.error_code === 'string' ? params.error_code : null
  const errorCode = isConsultorInviteErrorCode(rawError) ? rawError : null
  const passwordError = params.password_error === 'invalid' ? 'A senha nao atende aos requisitos ou a confirmacao nao confere.' : null
  const completionError = params.completion_error === 'true' ? 'Nao foi possivel concluir a ativacao. Procure o administrador.' : null
  if (errorCode) return <Shell><EstadoErro code={errorCode} /></Shell>
  if (tokenHash || type) {
    if (!isConsultorInviteToken(tokenHash) || type !== 'invite') return <Shell><EstadoErro code="AUTH_TOKEN_INVALID" /></Shell>
    return <Shell><p className="mt-5 text-sm leading-6 text-white/75">Defina sua senha. O convite sera confirmado e o MFA permanecera obrigatorio antes do acesso ao portal.</p><ConsultorInvitePasswordForm tokenHash={tokenHash} initialError={passwordError} /></Shell>
  }
  if (await obterFluxoAutenticacao() !== 'consultor_invite') return <Shell><EstadoErro code="AUTH_TOKEN_INVALID" /></Shell>
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <Shell><EstadoErro code="AUTH_TOKEN_INVALID" /></Shell>
  const { data: profile } = await supabase.from('profiles').select('role, status').eq('id', user.id).maybeSingle()
  if (!profile || profile.role !== 'consultor' || profile.status !== 'inativo') return <Shell><EstadoErro code="PROFILE_INVALID" /></Shell>
  return <Shell><p className="mt-5 text-sm leading-6 text-white/75">O convite foi confirmado. Defina novamente a senha para retomar a conclusao.</p><ConsultorInvitePasswordForm initialError={completionError} /></Shell>
}

function EstadoErro({ code }: { code: ConsultorInviteErrorCode }) { return <div className="mt-6 space-y-4"><div className="rounded-xl border border-red-300/40 bg-red-300/10 p-4 text-sm text-red-100">{mensagemConviteConsultor(code)}</div><Link href="/login" className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black">Voltar ao login</Link></div> }
function Shell({ children }: { children: ReactNode }) { return <main className="flex min-h-screen items-center justify-center bg-[#125dcc] px-6 py-10 text-white"><section className="w-full max-w-lg rounded-2xl border border-white/20 bg-white/10 p-7 shadow-xl backdrop-blur sm:p-9"><Link href="/login" className="mb-6 inline-flex items-center gap-2 text-sm text-white/75"><ArrowLeft size={16} /> Voltar ao login</Link><div className="flex items-center gap-3"><div className="flex size-12 items-center justify-center rounded-xl bg-white text-[#125dcc]"><ShieldCheck size={24} /></div><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Convite de acesso</p><h1 className="text-2xl font-bold">Ativar conta da Consultoria</h1></div></div>{children}</section></main> }
