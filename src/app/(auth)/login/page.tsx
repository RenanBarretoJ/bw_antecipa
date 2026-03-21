'use client'

import { useActionState, useState, useEffect, useRef } from 'react'
import { login } from '@/app/actions/auth'
import Link from 'next/link'

const MAX_ATTEMPTS = 5
const LOCKOUT_DURATION = 15 * 60 * 1000 // 15 minutos

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, undefined)
  const [attempts, setAttempts] = useState(0)
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null)
  const [lockoutRemaining, setLockoutRemaining] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)

  const isLockedOut = lockoutUntil !== null && Date.now() < lockoutUntil

  // Contador regressivo do bloqueio
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

  // Detectar tentativa falha
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">BW Antecipa</h1>
            <p className="text-gray-500 mt-2">Portal de Antecipacao de Recebiveis</p>
          </div>

          {isLockedOut ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
              <p className="text-red-700 font-medium">Acesso bloqueado</p>
              <p className="text-red-600 text-sm mt-1">
                Muitas tentativas falhas. Tente novamente em{' '}
                {Math.floor(lockoutRemaining / 60)}:{String(lockoutRemaining % 60).padStart(2, '0')}
              </p>
            </div>
          ) : (
            <form ref={formRef} action={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  E-mail
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                  placeholder="seu@email.com"
                />
                {state?.errors?.email && (
                  <p className="text-red-600 text-sm mt-1">{state.errors.email[0]}</p>
                )}
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                  Senha
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                  placeholder="Sua senha"
                />
                {state?.errors?.password && (
                  <div className="mt-1">
                    {state.errors.password.map((error) => (
                      <p key={error} className="text-red-600 text-sm">{error}</p>
                    ))}
                  </div>
                )}
              </div>

              {state?.message && (
                <div className={`rounded-lg p-3 text-sm ${
                  state.message.includes('sucesso')
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {state.message}
                </div>
              )}

              {attempts > 0 && attempts < MAX_ATTEMPTS && (
                <p className="text-amber-600 text-sm text-center">
                  {MAX_ATTEMPTS - attempts} tentativa(s) restante(s)
                </p>
              )}

              <button
                type="submit"
                disabled={pending || isLockedOut}
                className="w-full py-2.5 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {pending ? 'Entrando...' : 'Entrar'}
              </button>
            </form>
          )}

          <div className="mt-6 text-center">
            <p className="text-gray-500 text-sm">
              Nao tem conta?{' '}
              <Link href="/cadastro" className="text-blue-600 hover:text-blue-700 font-medium">
                Cadastre-se
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
