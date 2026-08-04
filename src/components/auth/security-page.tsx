'use client'

import { useActionState, useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, RefreshCcw, ShieldCheck, Smartphone, UsersRound, XCircle, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { encerrarOutrasSessoes, listarFatoresMfa, regenerarCodigosRecuperacao, type MfaActionState } from '@/app/actions/mfa'
import { alterarSenhaAutenticado, solicitarNonceAlteracaoSenha, type PasswordActionState } from '@/app/actions/password'
import { avaliarForcaSenha } from '@/lib/auth/password'
import { useNotifications } from '@/components/notifications/notification-provider'
import { useRouter } from 'next/navigation'

type Factor = { id: string; friendlyName: string; status: string }
type SecurityData = NonNullable<Awaited<ReturnType<typeof listarFatoresMfa>>['data']>

export function SecurityPage() {
  const notifications = useNotifications()
  const router = useRouter()
  const [data, setData] = useState<SecurityData | null>(null)
  const [codes, setCodes] = useState<string[]>([])
  const [newPassword, setNewPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [showNonce, setShowNonce] = useState(false)
  const [recoveryMfaCode, setRecoveryMfaCode] = useState('')
  const [sessionsMfaCode, setSessionsMfaCode] = useState('')
  const [isPending, startTransition] = useTransition()
  const [passwordState, passwordAction, passwordPending] = useActionState<PasswordActionState | undefined, FormData>(alterarSenhaAutenticado, undefined)
  const passwordStrength = useMemo(() => avaliarForcaSenha(newPassword), [newPassword])

  const load = useCallback(async () => {
    const result = await listarFatoresMfa()
    if (result.success && result.data) setData(result.data)
    else notifications.fromActionResult(result, 'Não foi possível carregar os dados de segurança.')
  }, [notifications])

  // Sincroniza a tela de seguranca com o estado remoto do Supabase Auth.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!passwordState?.message) return
    notifications.fromActionResult(passwordState)
    if (passwordState.success && passwordState.redirectTo) router.replace(passwordState.redirectTo)
  }, [notifications, passwordState, router])

  function run(action: () => Promise<MfaActionState<{ recoveryCodes?: string[] } | unknown>>) {
    startTransition(async () => {
      const result = await action()
      notifications.fromActionResult(result)
      const maybeCodes = result.data as { recoveryCodes?: string[] } | undefined
      if (maybeCodes?.recoveryCodes) setCodes(maybeCodes.recoveryCodes)
      await load()
    })
  }

  const estado = data?.estado
  const fatores = data?.fatores || []
  const mfaAtivo = !!estado?.possuiFatorVerificado
  const mfaObrigatorio = !!estado?.exigeMfa

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 pb-10 sm:px-6 lg:px-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Minha conta</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Seguranca</h1>
        <p className="mt-2 text-sm text-muted-foreground">Gerencie MFA, codigos de recuperacao e sessoes. Segredos, tokens e QR Code nao sao exibidos apos a ativacao.</p>
      </div>

      {!data ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground"><Loader2 className="animate-spin" size={16} /> Carregando seguranca...</div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <MetricCard icon={ShieldCheck} label="MFA obrigatorio" value={estado?.exigeMfa ? 'Sim' : 'Nao'} />
            <MetricCard icon={Smartphone} label="MFA configurado" value={mfaAtivo ? 'Sim' : 'Nao'} />
            <MetricCard icon={KeyRound} label="Sessao elevada" value={estado?.aalAtual === 'aal2' && estado.sessaoElevadaValida ? 'AAL2 valida' : 'Requer codigo'} />
            <MetricCard icon={RefreshCcw} label="Recovery codes" value={`${estado?.recoveryCodesRestantes || 0} restantes`} />
          </section>

          <section className="rounded-2xl border border-border bg-card">
            <div className="border-b border-border p-5">
              <h2 className="font-semibold">Fatores cadastrados</h2>
            </div>
            <div className="space-y-3 p-5">
              {fatores.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-background p-5 text-sm text-muted-foreground">
                  Nenhum fator ativo. <Link href="/mfa/setup" className="font-semibold text-primary underline">Configurar MFA</Link>
                </div>
              ) : fatores.map((factor: Factor) => (
                <div key={factor.id} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">{factor.friendlyName}</p>
                    <p className="text-xs text-muted-foreground">Status: {factor.status}</p>
                  </div>
                  <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    Obrigatorio pela politica
                  </span>
                </div>
              ))}
              {mfaObrigatorio && <p className="text-xs text-muted-foreground">MFA e obrigatorio para todos os perfis. A desativacao nao fica disponivel para o proprio usuario; reset deve ser tratado por fluxo administrativo auditado.</p>}
              {!estado?.sessaoElevadaValida && <p className="text-xs text-muted-foreground">Para regenerar codigos, validar sessoes ou encerrar outras sessoes, valide sua sessao em <Link href="/mfa/desafio" className="text-primary underline">MFA</Link>.</p>}
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><LockKeyhole size={18} /></div>
                <div>
                  <h2 className="font-semibold">Alterar senha</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Valide a senha atual e defina uma nova senha forte. Outras sessoes serao encerradas.</p>
                </div>
              </div>
              <form action={passwordAction} className="mt-5 space-y-4">
                <PasswordInput id="currentPassword" name="currentPassword" label="Senha atual" show={showCurrentPassword} setShow={setShowCurrentPassword} autoComplete="current-password" error={passwordState?.errors?.currentPassword?.[0]} />
                <PasswordInput id="password" name="password" label="Nova senha" show={showNewPassword} setShow={setShowNewPassword} value={newPassword} onChange={setNewPassword} autoComplete="new-password" error={passwordState?.errors?.password?.[0]} />
                <PasswordInput id="confirmPassword" name="confirmPassword" label="Confirmar nova senha" show={showConfirmPassword} setShow={setShowConfirmPassword} autoComplete="new-password" error={passwordState?.errors?.confirmPassword?.[0]} />
                <div className="space-y-1.5">
                  <Label htmlFor="passwordMfaCode">Código TOTP para confirmar</Label>
                  <Input id="passwordMfaCode" name="mfaCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="000000" className="h-10 font-mono tracking-[0.2em]" aria-invalid={!!passwordState?.errors?.mfaCode} />
                  {passwordState?.errors?.mfaCode?.[0] && <p className="text-xs text-destructive">{passwordState.errors.mfaCode[0]}</p>}
                </div>
                {showNonce ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="nonce">Codigo de reautenticacao</Label>
                    <Input id="nonce" name="nonce" inputMode="numeric" autoComplete="one-time-code" placeholder="Informe apenas se solicitado pelo Supabase" className="h-10" />
                    <p className="text-xs text-muted-foreground">Use este campo somente quando o Supabase exigir nonce para troca de senha recente.</p>
                  </div>
                ) : null}
                <div className="rounded-xl border border-border bg-background p-3">
                  <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(passwordStrength.score / 5) * 100}%` }} />
                  </div>
                  <div className="grid gap-1.5 text-xs text-muted-foreground">
                    {passwordStrength.checks.map((check) => (
                      <span key={check.key} className="inline-flex items-center gap-2">
                        {check.valid ? <CheckCircle2 size={13} className="text-success-foreground" /> : <XCircle size={13} className="text-muted-foreground/60" />}
                        {check.label}
                      </span>
                    ))}
                  </div>
                </div>
                <Button type="button" variant="outline" disabled={isPending || passwordPending || !estado?.sessaoElevadaValida} onClick={() => run(async () => {
                  setShowNonce(true)
                  return solicitarNonceAlteracaoSenha()
                })} className="w-full">
                  Solicitar codigo de reautenticacao
                </Button>
                <Button type="submit" disabled={passwordPending} className="w-full">{passwordPending ? <><Loader2 size={16} className="animate-spin" /> Alterando...</> : 'Alterar senha'}</Button>
              </form>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-semibold">Codigos de recuperacao</h2>
              <p className="mt-2 text-sm text-muted-foreground">Gerar novos codigos invalida todos os codigos anteriores nao utilizados.</p>
              <Label htmlFor="recoveryMfaCode" className="mt-4 block">Código TOTP para confirmar</Label>
              <Input id="recoveryMfaCode" value={recoveryMfaCode} onChange={(event) => setRecoveryMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className="mt-2 font-mono tracking-[0.2em]" />
              <Button type="button" className="mt-3" variant="outline" disabled={isPending || !estado?.sessaoElevadaValida || !mfaAtivo || recoveryMfaCode.length !== 6} onClick={() => run(async () => { const response = await regenerarCodigosRecuperacao(recoveryMfaCode); if (response.success) setRecoveryMfaCode(''); return response })}>Gerar novos codigos</Button>
              {codes.length > 0 && <div className="mt-4 grid gap-2">{codes.map((code) => <code key={code} className="rounded-lg border border-border bg-background px-3 py-2 text-center font-mono text-sm">{code}</code>)}</div>}
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-semibold">Sessoes</h2>
              <p className="mt-2 text-sm text-muted-foreground">Encerre outras sessoes autenticadas da sua conta apos troca de dispositivo, perda de acesso ou suspeita de uso indevido.</p>
              <Label htmlFor="sessionsMfaCode" className="mt-4 block">Código TOTP para confirmar</Label>
              <Input id="sessionsMfaCode" value={sessionsMfaCode} onChange={(event) => setSessionsMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className="mt-2 font-mono tracking-[0.2em]" />
              <Button type="button" className="mt-3" variant="outline" disabled={isPending || !estado?.sessaoElevadaValida || sessionsMfaCode.length !== 6} onClick={() => run(async () => { const response = await encerrarOutrasSessoes(sessionsMfaCode); if (response.success) setSessionsMfaCode(''); return response })}><UsersRound size={16} /> Encerrar outras sessoes</Button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function PasswordInput({ id, name, label, show, setShow, value, onChange, autoComplete, error }: {
  id: string
  name: string
  label: string
  show: boolean
  setShow: (value: boolean) => void
  value?: string
  onChange?: (value: string) => void
  autoComplete?: string
  error?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input id={id} name={name} type={show ? 'text' : 'password'} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined} autoComplete={autoComplete} required className="h-10 pl-10 pr-10" aria-invalid={!!error} />
        <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function MetricCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <Icon className="text-primary" size={18} />
      <p className="mt-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  )
}
