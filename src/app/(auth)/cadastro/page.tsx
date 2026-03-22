'use client'

import { useActionState } from 'react'
import { signup } from '@/app/actions/auth'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle, ShieldCheck, TrendingUp, Zap } from 'lucide-react'

export default function CadastroPage() {
  const [state, formAction, pending] = useActionState(signup, undefined)

  const isSuccess = state?.message?.includes('sucesso')

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
          <p className="text-primary-foreground/70 text-sm mt-1">Blue Wave Asset Management</p>
        </div>

        <div className="relative z-10 space-y-8">
          <h2 className="text-3xl font-bold leading-tight">
            Comece a antecipar seus recebiveis hoje mesmo
          </h2>

          <div className="space-y-5">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
                <Zap size={20} />
              </div>
              <div>
                <p className="font-semibold">Cadastro rapido</p>
                <p className="text-sm text-primary-foreground/70">Crie sua conta em poucos minutos</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
                <ShieldCheck size={20} />
              </div>
              <div>
                <p className="font-semibold">Dados protegidos</p>
                <p className="text-sm text-primary-foreground/70">Criptografia de ponta a ponta</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
                <TrendingUp size={20} />
              </div>
              <div>
                <p className="font-semibold">Aprovacao agil</p>
                <p className="text-sm text-primary-foreground/70">Analise e aprovacao em ate 24h</p>
              </div>
            </div>
          </div>
        </div>

        <p className="relative z-10 text-xs text-primary-foreground/50">
          2024-2026 Blue Wave Asset Management. Todos os direitos reservados.
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

          <Card className="border-0 shadow-none bg-transparent">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="text-2xl font-bold">Criar nova conta</CardTitle>
              <CardDescription>
                Preencha os dados abaixo para comecar
              </CardDescription>
            </CardHeader>

            <CardContent className="px-0">
              {isSuccess ? (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-8 text-center">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle size={28} className="text-emerald-600" />
                  </div>
                  <p className="text-emerald-800 font-semibold text-lg mb-1">Conta criada com sucesso!</p>
                  <p className="text-emerald-600 text-sm mb-6">{state?.message}</p>
                  <Link href="/login">
                    <Button variant="default" className="h-11">
                      Fazer login
                    </Button>
                  </Link>
                </div>
              ) : (
                <form action={formAction} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="nome_completo">Nome completo</Label>
                    <Input
                      id="nome_completo"
                      name="nome_completo"
                      type="text"
                      required
                      placeholder="Digite seu nome completo"
                      className="h-11"
                      aria-invalid={!!state?.errors?.nome_completo}
                    />
                    {state?.errors?.nome_completo && (
                      <p className="text-destructive text-sm">{state.errors.nome_completo[0]}</p>
                    )}
                  </div>

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
                      required
                      placeholder="Minimo 8 caracteres"
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

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirmar senha</Label>
                    <Input
                      id="confirmPassword"
                      name="confirmPassword"
                      type="password"
                      required
                      placeholder="Repita a senha"
                      className="h-11"
                      aria-invalid={!!state?.errors?.confirmPassword}
                    />
                    {state?.errors?.confirmPassword && (
                      <p className="text-destructive text-sm">{state.errors.confirmPassword[0]}</p>
                    )}
                  </div>

                  {state?.message && !isSuccess && (
                    <div className="bg-destructive/10 text-destructive border border-destructive/20 rounded-lg p-3 text-sm">
                      {state.message}
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={pending}
                    className="w-full h-11 text-sm font-semibold"
                    size="lg"
                  >
                    {pending ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Criando conta...
                      </>
                    ) : (
                      'Criar conta'
                    )}
                  </Button>
                </form>
              )}

              {!isSuccess && (
                <div className="mt-8 text-center">
                  <p className="text-muted-foreground text-sm">
                    Ja tem conta?{' '}
                    <Link href="/login" className="text-primary hover:text-primary/80 font-semibold transition-colors">
                      Fazer login
                    </Link>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
