'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Eye, EyeOff, Loader2, XCircle } from 'lucide-react'
import { concluirConviteConsultor, type ConviteConsultorActionState } from '@/app/actions/convite-consultor'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { avaliarForcaSenha } from '@/lib/auth/password'

export function ConsultorInvitePasswordForm({ tokenHash, initialError }: { tokenHash?: string; initialError?: string | null }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [posting, setPosting] = useState(false)
  const [state, formAction, pending] = useActionState<ConviteConsultorActionState, FormData>(concluirConviteConsultor, undefined)
  const strength = useMemo(() => avaliarForcaSenha(password), [password])
  useEffect(() => { if (state?.message) { notifications.fromActionResult(state); if (state.redirectTo) router.replace(state.redirectTo) } }, [notifications, router, state])
  const content = <>
    {tokenHash && <><input type="hidden" name="token_hash" value={tokenHash} /><input type="hidden" name="type" value="invite" /></>}
    <PasswordField id="consultor-password" name="password" label="Nova senha" value={password} onChange={setPassword} show={show} toggle={() => setShow((v) => !v)} />
    <PasswordField id="consultor-confirm-password" name="confirmPassword" label="Confirmar senha" show={showConfirm} toggle={() => setShowConfirm((v) => !v)} />
    <div className="rounded-xl border border-white/20 bg-white/10 p-4"><div className="mb-3 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-white" style={{ width: `${(strength.score / 5) * 100}%` }} /></div><div className="grid gap-2 text-xs text-white/75 sm:grid-cols-2">{strength.checks.map((check) => <span key={check.key} className="inline-flex items-center gap-2">{check.valid ? <CheckCircle2 size={14} className="text-emerald-200" /> : <XCircle size={14} className="text-white/40" />}{check.label}</span>)}</div></div>
    {(initialError || state?.errors) && <div className="rounded-xl border border-red-300/40 bg-red-300/10 p-4 text-sm text-red-100">{initialError || Object.values(state?.errors || {}).flat().join(' ')}</div>}
    <Button type="submit" disabled={posting || pending} className="h-10 w-full bg-white text-black hover:bg-white/90">{posting || pending ? <><Loader2 size={16} className="animate-spin" /> Ativando...</> : 'Aceitar convite e continuar'}</Button>
  </>
  if (tokenHash) return <form method="post" action="/auth/convite-consultor/confirm" onSubmit={() => setPosting(true)} className="mt-6 space-y-5">{content}</form>
  return <form action={formAction} className="mt-6 space-y-5">{content}</form>
}

function PasswordField({ id, name, label, show, toggle, value, onChange }: { id: string; name: string; label: string; show: boolean; toggle: () => void; value?: string; onChange?: (value: string) => void }) {
  return <div><Label htmlFor={id} className="mb-2 text-white">{label}</Label><div className="relative"><Input id={id} name={name} type={show ? 'text' : 'password'} value={value} onChange={onChange ? (e) => onChange(e.target.value) : undefined} required autoComplete="new-password" className="border-white/20 bg-white/10 pr-10 text-white placeholder:text-white/40" /><button type="button" onClick={toggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/70">{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
}
