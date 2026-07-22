'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { KeyRound, Loader2, RefreshCcw, ShieldCheck, Smartphone, UsersRound, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { desativarMfaProprio, encerrarOutrasSessoes, listarFatoresMfa, regenerarCodigosRecuperacao, type MfaActionState } from '@/app/actions/mfa'

type Factor = { id: string; friendlyName: string; status: string }
type SecurityData = NonNullable<Awaited<ReturnType<typeof listarFatoresMfa>>['data']>

export function SecurityPage() {
  const [data, setData] = useState<SecurityData | null>(null)
  const [message, setMessage] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()

  async function load() {
    const result = await listarFatoresMfa()
    if (result.success && result.data) setData(result.data)
    else setMessage(result.message)
  }

  // Sincroniza a tela de seguranca com o estado remoto do Supabase Auth.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [])

  function run(action: () => Promise<MfaActionState<{ recoveryCodes?: string[] } | unknown>>) {
    startTransition(async () => {
      const result = await action()
      setMessage(result.message)
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

      {message && <div className="rounded-xl border border-border bg-card p-4 text-sm">{message}</div>}

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
                  {mfaObrigatorio ? (
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Obrigatorio pela politica</span>
                  ) : (
                    <Button type="button" variant="destructive" size="sm" disabled={isPending || !estado?.sessaoElevadaValida} onClick={() => run(() => desativarMfaProprio(factor.id))}>Desativar MFA</Button>
                  )}
                </div>
              ))}
              {mfaObrigatorio && <p className="text-xs text-muted-foreground">MFA e obrigatorio para este perfil. A desativacao nao fica disponivel para o proprio usuario; reset ou excecao deve ser tratado por fluxo administrativo.</p>}
              {!estado?.sessaoElevadaValida && <p className="text-xs text-muted-foreground">Para regenerar codigos, validar sessoes ou encerrar outras sessoes, valide sua sessao em <Link href="/mfa/desafio" className="text-primary underline">MFA</Link>.</p>}
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-semibold">Codigos de recuperacao</h2>
              <p className="mt-2 text-sm text-muted-foreground">Gerar novos codigos invalida todos os codigos anteriores nao utilizados.</p>
              <Button type="button" className="mt-4" variant="outline" disabled={isPending || !estado?.sessaoElevadaValida || !mfaAtivo} onClick={() => run(regenerarCodigosRecuperacao)}>Gerar novos codigos</Button>
              {codes.length > 0 && <div className="mt-4 grid gap-2">{codes.map((code) => <code key={code} className="rounded-lg border border-border bg-background px-3 py-2 text-center font-mono text-sm">{code}</code>)}</div>}
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="font-semibold">Sessoes</h2>
              <p className="mt-2 text-sm text-muted-foreground">Encerre outras sessoes autenticadas da sua conta apos troca de dispositivo, perda de acesso ou suspeita de uso indevido.</p>
              <Button type="button" className="mt-4" variant="outline" disabled={isPending || !estado?.sessaoElevadaValida} onClick={() => run(encerrarOutrasSessoes)}><UsersRound size={16} /> Encerrar outras sessoes</Button>
            </div>
          </section>
        </>
      )}
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
