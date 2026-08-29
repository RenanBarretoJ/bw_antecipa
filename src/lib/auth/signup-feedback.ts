export type SignupFeedback = {
  authenticated: boolean
  message: string
}

export function buildSignupFeedback(hasSession: boolean): SignupFeedback {
  if (hasSession) {
    return {
      authenticated: true,
      message: 'Conta criada e confirmada automaticamente. Continue para concluir seu cadastro.',
    }
  }

  return {
    authenticated: false,
    message: 'Conta criada com sucesso! Verifique seu e-mail para confirmar o cadastro.',
  }
}
