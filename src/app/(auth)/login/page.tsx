'use client'

import { useActionState, useState, useEffect, useRef } from 'react'
import { login } from '@/app/actions/auth'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Loader2, ShieldCheck, TrendingUp, Zap } from 'lucide-react'

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
      } else {
        setLockoutRemaining(Math.ceil(remaining / 1000))
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [lockoutUntil])

  useEffect(() => {
    if (state?.message && !pending) {
      const newAttempts = attempts + 1
      setAttempts(newAttempts)
      if (newAttempts >= MAX_ATTEMPTS) {
        setLockoutUntil(Date.now() + LOCKOUT_DURATION)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, pending])

  const handleSubmit = (formData: FormData) => {
    if (isLockedOut) return
    formAction(formData)
  }

  return (
    <div className="min-h-screen flex">
      {/* Painel esquerdo - branding */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[560px] bg-gradient-to-br from-primary via-primary/90 to-primary/70 text-primary-foreground flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 -left-10 w-72 h-72 rounded-full bg-white/20 blur-3xl" />
          <div className="absolute bottom-20 right-10 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center font-bold text-lg">
              BW
            </div>
            <span className="text-xl font-bold tracking-tight">Antecipa</span>
          </div>
          <p className="text-primary-foreground/70 text-sm mt-1">BW BI LTDA</p>
        </div>

        <div className="relative z-10 space-y-8">
          <h2 className="text-3xl font-bold leading-tight">
            Antecipacao de recebiveis com seguranca e agilidade
          </h2>

          <div className="space-y-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
                <Zap size={20} />
              </div>
              <div>
                <p className="font-semibold">Rapido e digital</p>
                <p className="text-sm text-primary-foreground/70">Processo 100% online, do envio ao desembolso</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
                <ShieldCheck size={20} />
              </div>
              <div>
                <p className="font-semibold">Conta escrow segura</p>
                <p className="text-sm text-primary-foreground/70">Recursos protegidos em conta vinculada</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
                <TrendingUp size={20} />
              </div>
              <div>
                <p className="font-semibold">Taxas competitivas</p>
                <p className="text-sm text-primary-foreground/70">Condicoes personalizadas para seu perfil</p>
              </div>
            </div>
          </div>
        </div>

        <p className="relative z-10 text-xs text-primary-foreground/50">
          2024-2026 BW BI LTDA. Todos os direitos reservados.
        </p>
      </div>

      {/* Painel direito - formulario */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-8 py-12 bg-background">
        <div className="w-full max-w-[420px]">
          {/* Logo mobile */}
          <div className="lg:hidden flex items-center gap-3 mb-10 justify-center">
            <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-bold text-lg">
              BW
            </div>
            <span className="text-xl font-bold tracking-tight text-foreground">Antecipa</span>
          </div>

          <Card className="shadow-sm border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-2xl font-bold">Bem-vindo de volta</CardTitle>
              <CardDescription className="text-muted-foreground">
                Entre com suas credenciais para acessar o portal
              </CardDescription>
            </CardHeader>

            <CardContent>
              {isLockedOut ? (
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-5 text-center">
                  <ShieldCheck size={28} className="text-destructive mx-auto mb-2" />
                  <p className="text-destructive font-semibold">Acesso temporariamente bloqueado</p>
                  <p className="text-destructive/80 text-sm mt-1">
                    Muitas tentativas falhas. Tente novamente em{' '}
                    <span className="font-mono font-bold">
                      {Math.floor(lockoutRemaining / 60)}:{String(lockoutRemaining % 60).padStart(2, '0')}
                    </span>
                  </p>
                </div>
              ) : (
                <form ref={formRef} action={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="email">E-mail</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      placeholder="seu@email.com"
                      className="h-11"
                      aria-invalid={!!state?.errors?.email}
                    />
                    {state?.errors?.email && (
                      <p className="text-destructive text-sm">{state.errors.email[0]}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Senha</Label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      placeholder="Sua senha"
                      className="h-11"
                      aria-invalid={!!state?.errors?.password}
                    />
                    {state?.errors?.password && (
                      <div className="space-y-1">
                        {state.errors.password.map((error) => (
                          <p key={error} className="text-destructive text-sm">{error}</p>
                        ))}
                      </div>
                    )}
                  </div>

                  {state?.message && (
                    <div className={`rounded-lg p-3 text-sm ${
                      state.message.includes('sucesso')
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-destructive/10 text-destructive border border-destructive/20'
                    }`}>
                      {state.message}
                    </div>
                  )}

                  {attempts > 0 && attempts < MAX_ATTEMPTS && (
                    <p className="text-amber-600 text-sm text-center bg-amber-50 rounded-lg py-2">
                      {MAX_ATTEMPTS - attempts} tentativa(s) restante(s)
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={pending || isLockedOut}
                    className="w-full h-11 text-sm font-semibold"
                    size="lg"
                  >
                    {pending ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Entrando...
                      </>
                    ) : (
                      'Entrar'
                    )}
                  </Button>
                </form>
              )}

              <div className="mt-6 text-center">
                <p className="text-muted-foreground text-sm">
                  Nao tem conta?{' '}
                  <Link href="/cadastro" className="text-primary hover:text-primary/80 font-semibold transition-colors">
                    Cadastre-se
                  </Link>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
