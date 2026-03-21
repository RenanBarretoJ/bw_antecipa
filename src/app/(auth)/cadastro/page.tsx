'use client'

import { useActionState } from 'react'
import { signup } from '@/app/actions/auth'
import Link from 'next/link'

export default function CadastroPage() {
  const [state, formAction, pending] = useActionState(signup, undefined)

  const isSuccess = state?.message?.includes('sucesso')

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">BW Antecipa</h1>
            <p className="text-gray-500 mt-2">Criar nova conta</p>
          </div>

          {isSuccess ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <p className="text-green-700 font-medium">{state?.message}</p>
              <Link
                href="/login"
                className="inline-block mt-4 text-blue-600 hover:text-blue-700 font-medium"
              >
                Voltar para o login
              </Link>
            </div>
          ) : (
            <form action={formAction} className="space-y-5">
              <div>
                <label htmlFor="nome_completo" className="block text-sm font-medium text-gray-700 mb-1">
                  Nome completo
                </label>
                <input
                  id="nome_completo"
                  name="nome_completo"
                  type="text"
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                  placeholder="Seu nome completo"
                />
                {state?.errors?.nome_completo && (
                  <p className="text-red-600 text-sm mt-1">{state.errors.nome_completo[0]}</p>
                )}
              </div>

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
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                  placeholder="Min. 8 caracteres"
                />
                {state?.errors?.password && (
                  <div className="mt-1">
                    {state.errors.password.map((error) => (
                      <p key={error} className="text-red-600 text-sm">{error}</p>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
                  Confirmar senha
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                  placeholder="Repita a senha"
                />
                {state?.errors?.confirmPassword && (
                  <p className="text-red-600 text-sm mt-1">{state.errors.confirmPassword[0]}</p>
                )}
              </div>

              {state?.message && !isSuccess && (
                <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg p-3 text-sm">
                  {state.message}
                </div>
              )}

              <button
                type="submit"
                disabled={pending}
                className="w-full py-2.5 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {pending ? 'Criando conta...' : 'Criar conta'}
              </button>
            </form>
          )}

          {!isSuccess && (
            <div className="mt-6 text-center">
              <p className="text-gray-500 text-sm">
                Ja tem conta?{' '}
                <Link href="/login" className="text-blue-600 hover:text-blue-700 font-medium">
                  Fazer login
                </Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
