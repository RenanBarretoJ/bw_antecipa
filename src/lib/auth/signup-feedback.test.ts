import { describe, expect, it } from 'vitest'
import { buildSignupFeedback } from './signup-feedback'

describe('feedback do cadastro de usuario', () => {
  it('orienta a continuar quando o Supabase cria uma sessao auto-confirmada', () => {
    expect(buildSignupFeedback(true)).toEqual({
      authenticated: true,
      message: 'Conta criada e confirmada automaticamente. Continue para concluir seu cadastro.',
    })
  })

  it('orienta a confirmar o e-mail quando nenhuma sessao e criada', () => {
    expect(buildSignupFeedback(false)).toEqual({
      authenticated: false,
      message: 'Conta criada com sucesso! Verifique seu e-mail para confirmar o cadastro.',
    })
  })
})
