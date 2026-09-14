import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireGestor: vi.fn(),
  resolverFundo: vi.fn(),
  preflight: vi.fn(),
  gerarToken: vi.fn(),
  gerarLink: vi.fn(),
  enviarEmail: vi.fn(),
  rpc: vi.fn(),
  NovoCedenteAuthError: class NovoCedenteAuthError extends Error {
    constructor(
      readonly code: 'EMAIL_ALREADY_REGISTERED' | 'AUTH_GENERATE_LINK_FAILED',
      readonly providerCode: string | null,
      readonly status: number | null,
    ) {
      super(code)
    }
  },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/authorization', () => ({ requireGestor: mocks.requireGestor }))
vi.mock('@/lib/onboarding-cedentes/contexto.server', () => ({
  resolverFundoAtivoOnboarding: mocks.resolverFundo,
}))
vi.mock('@/lib/auth/novo-cedente-invite.server', () => ({
  consultarDisponibilidadeEmailNovoCedente: mocks.preflight,
  gerarTokenConviteNovoCedente: mocks.gerarToken,
  gerarLinkAuthNovoCedente: mocks.gerarLink,
  enviarEmailConviteNovoCedente: mocks.enviarEmail,
  NovoCedenteAuthError: mocks.NovoCedenteAuthError,
}))

import { convidarNovoCedente } from './convite-novo-cedente'

const fundoId = '11111111-1111-4111-8111-111111111111'
const input = {
  fundoId,
  cnpj: '11.222.333/0001-81',
  email: ' RESPONSAVEL@EXAMPLE.COM ',
}
const convite = {
  convite_id: '22222222-2222-4222-8222-222222222222',
  fundo_id: fundoId,
  fundo_nome: 'Fundo QA',
  cnpj: '11222333000181',
  email: 'responsavel@example.com',
  expires_at: '2026-09-14T15:00:00Z',
}

describe('P6.1 - orquestracao do convite de novo Cedente', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireGestor.mockResolvedValue({
      user: { id: '33333333-3333-4333-8333-333333333333' },
      profile: { role: 'gestor', status: 'ativo' },
      supabase: { rpc: mocks.rpc },
    })
    mocks.resolverFundo.mockResolvedValue({ id: fundoId, nome: 'Fundo QA', cnpj: null })
    mocks.preflight.mockResolvedValue({ outcome: 'AVAILABLE' })
    mocks.gerarToken.mockReturnValue({ token: 'a'.repeat(64), tokenHash: 'b'.repeat(64) })
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'criar_convite_novo_cedente') return { data: convite, error: null }
      if (name === 'cancelar_convite_novo_cedente') return { data: { cancelado: true }, error: null }
      return { data: null, error: null }
    })
    mocks.gerarLink.mockResolvedValue({ confirmUrl: 'https://example.test/auth/confirm', userId: 'auth-user' })
    mocks.enviarEmail.mockResolvedValue({ success: true })
  })

  it('bloqueia e-mail existente antes de qualquer escrita ou generateLink', async () => {
    mocks.preflight.mockResolvedValue({ outcome: 'ALREADY_EXISTS' })

    const result = await convidarNovoCedente(input)

    expect(result).toEqual({
      success: false,
      code: 'EMAIL_ALREADY_REGISTERED',
      message: 'Este e-mail já está cadastrado na plataforma. Para cadastrar um novo Cedente/CNPJ, informe um novo e-mail para o responsável.',
    })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.gerarLink).not.toHaveBeenCalled()
    expect(mocks.enviarEmail).not.toHaveBeenCalled()
  })

  it('falha fechado quando nao consegue consultar o Auth', async () => {
    mocks.preflight.mockResolvedValue({ outcome: 'LOOKUP_ERROR', providerCode: 'timeout', status: null })

    const result = await convidarNovoCedente(input)

    expect(result).toMatchObject({ success: false, code: 'AUTH_LOOKUP_FAILED' })
    expect(result.message).toContain('Não foi possível validar o e-mail')
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.gerarLink).not.toHaveBeenCalled()
  })

  it('mantem o fluxo invite-first para e-mail novo', async () => {
    const result = await convidarNovoCedente(input)

    expect(result).toEqual({
      success: true,
      message: 'Convite enviado para responsavel@example.com. O link expira em 1 hora.',
    })
    expect(mocks.preflight).toHaveBeenCalledWith('responsavel@example.com')
    expect(mocks.rpc).toHaveBeenCalledWith('criar_convite_novo_cedente', expect.objectContaining({
      p_fundo_id: fundoId,
      p_cnpj: '11222333000181',
      p_email: 'responsavel@example.com',
    }))
    expect(mocks.gerarLink).toHaveBeenCalledTimes(1)
    expect(mocks.enviarEmail).toHaveBeenCalledTimes(1)
  })

  it('compensa corrida quando generateLink informa que o e-mail passou a existir', async () => {
    mocks.gerarLink.mockRejectedValue(new mocks.NovoCedenteAuthError(
      'EMAIL_ALREADY_REGISTERED',
      'email_exists',
      422,
    ))

    const result = await convidarNovoCedente(input)

    expect(result).toMatchObject({ success: false, code: 'EMAIL_ALREADY_REGISTERED' })
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'cancelar_convite_novo_cedente', expect.objectContaining({
      p_convite_id: convite.convite_id,
      p_motivo: 'email_already_registered',
    }))
    expect(mocks.enviarEmail).not.toHaveBeenCalled()
  })

  it('diferencia falha do generateLink e falha de envio na auditoria de cancelamento', async () => {
    mocks.gerarLink.mockRejectedValueOnce(new mocks.NovoCedenteAuthError(
      'AUTH_GENERATE_LINK_FAILED',
      'service_unavailable',
      503,
    ))
    await convidarNovoCedente(input)
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'cancelar_convite_novo_cedente', expect.objectContaining({
      p_motivo: 'auth_generate_link_failed',
    }))

    vi.clearAllMocks()
    mocks.requireGestor.mockResolvedValue({ supabase: { rpc: mocks.rpc } })
    mocks.resolverFundo.mockResolvedValue({ id: fundoId })
    mocks.preflight.mockResolvedValue({ outcome: 'AVAILABLE' })
    mocks.gerarToken.mockReturnValue({ token: 'a'.repeat(64), tokenHash: 'b'.repeat(64) })
    mocks.rpc
      .mockResolvedValueOnce({ data: convite, error: null })
      .mockResolvedValueOnce({ data: { cancelado: true }, error: null })
    mocks.gerarLink.mockResolvedValue({ confirmUrl: 'https://example.test/auth/confirm', userId: 'auth-user' })
    mocks.enviarEmail.mockResolvedValue({ success: false, errorCode: 'SMTP_ERROR' })

    await convidarNovoCedente(input)
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'cancelar_convite_novo_cedente', expect.objectContaining({
      p_motivo: 'email_send_failed',
    }))
  })

  it('nao consulta o Auth quando o fundo informado nao e o contexto autorizado', async () => {
    mocks.resolverFundo.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444444',
    })

    const result = await convidarNovoCedente(input)

    expect(result.success).toBe(false)
    expect(mocks.preflight).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
