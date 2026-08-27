'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, XCircle } from 'lucide-react'
import { concluirConviteGestor, type ConviteGestorActionState } from '@/app/actions/convite-gestor'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { avaliarForcaSenha } from '@/lib/auth/password'

type GestorInvitePasswordFormProps = {
  confirmation?: {
    tokenHash: string
    role: 'gestor' | 'super_admin'
  }
  initialError?: string | null
}

export function GestorInvitePasswordForm({ confirmation, initialError }: GestorInvitePasswordFormProps = {}) {
  const router = useRouter()
  const notifications = useNotifications()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [submittingConfirmation, setSubmittingConfirmation] = useState(false)
  const [state, formAction, pending] = useActionState<ConviteGestorActionState, FormData>(concluirConviteGestor, undefined)
  const strength = useMemo(() => avaliarForcaSenha(password), [password])

  useEffect(() => {
    if (!state?.message) return
    notifications.fromActionResult(state)
    if (state.redirectTo) router.replace(state.redirectTo)
  }, [notifications, router, state])

  const busy = confirmation ? submittingConfirmation : pending
  const content = (
    <>
      {confirmation && (
        <>
          <input type="hidden" name="token_hash" value={confirmation.tokenHash} />
          <input type="hidden" name="type" value="invite" />
          <input type="hidden" name="role" value={confirmation.role} />
        </>
      )}
      <PasswordInput id="gestor-invite-password" name="password" label="Nova senha" value={password} onChange={setPassword} show={showPassword} onToggle={() => setShowPassword((value) => !value)} />
      <PasswordInput id="gestor-invite-confirm-password" name="confirmPassword" label="Confirmar senha" show={showConfirm} onToggle={() => setShowConfirm((value) => !value)} />

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

      {(initialError || state?.errors) && (
        <div className="rounded-xl border border-red-300/40 bg-red-300/10 p-4 text-sm text-red-100">
          {initialError || Object.values(state?.errors || {}).flat().join(' ')}
        </div>
      )}
      <Button type="submit" disabled={busy} className="h-10 w-full bg-white text-black hover:bg-white/90">
        {busy ? <><Loader2 size={16} className="animate-spin" /> Ativando...</> : 'Aceitar convite e continuar'}
      </Button>
    </>
  )

  if (confirmation) {
    return (
      <form
        method="post"
        action="/auth/convite-gestor/confirm"
        onSubmit={() => setSubmittingConfirmation(true)}
        className="mt-6 space-y-5"
      >
        {content}
      </form>
    )
  }

  return <form action={formAction} className="mt-6 space-y-5">{content}</form>
}

function PasswordInput({ id, name, label, show, onToggle, value, onChange }: {
  id: string
  name: string
  label: string
  show: boolean
  onToggle: () => void
  value?: string
  onChange?: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm text-white">{label}</Label>
      <div className="relative">
        <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-black" />
        <Input
          id={id}
          name={name}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined}
          autoComplete="new-password"
          required
          className="h-10 border-white/30 bg-white/10 pl-10 pr-10 text-white placeholder:text-white/65 focus-visible:border-white/60 focus-visible:ring-white/25"
        />
        <button type="button" onClick={onToggle} className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-black transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  )
}
