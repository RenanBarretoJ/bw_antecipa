import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  listUsers: vi.fn(),
  generateLink: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: mocks.createAdminClient,
}))
vi.mock('@/lib/email', () => ({ enviarEmailOperacional: vi.fn() }))

import {
  consultarDisponibilidadeEmailNovoCedente,
  gerarLinkAuthNovoCedente,
} from './novo-cedente-invite.server'

describe('P6.1 - preflight de e-mail no Supabase Auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createAdminClient.mockReturnValue({
      auth: { admin: { listUsers: mocks.listUsers, generateLink: mocks.generateLink } },
    })
    mocks.listUsers.mockResolvedValue({ data: { users: [] }, error: null })
  })

  it('considera disponivel somente depois de consultar o Auth', async () => {
    await expect(consultarDisponibilidadeEmailNovoCedente(' NOVO@EXAMPLE.COM '))
      .resolves.toEqual({ outcome: 'AVAILABLE' })
    expect(mocks.listUsers).toHaveBeenCalledWith({ page: 1, perPage: 1000 })
  })

  it.each(['cedente', 'gestor', 'sacado', 'super_admin'])(
    'bloqueia e-mail existente independentemente do papel %s',
    async (role) => {
      mocks.listUsers.mockResolvedValue({
        data: {
          users: [{ email: 'responsavel@example.com', user_metadata: { role } }],
        },
        error: null,
      })

      await expect(consultarDisponibilidadeEmailNovoCedente(' RESPONSAVEL@EXAMPLE.COM '))
        .resolves.toEqual({ outcome: 'ALREADY_EXISTS' })
    },
  )

  it('bloqueia identidade existente mesmo inativa ou revogada', async () => {
    mocks.listUsers.mockResolvedValue({
      data: {
        users: [{ email: 'inativo@example.com', banned_until: '2126-01-01T00:00:00Z' }],
      },
      error: null,
    })

    await expect(consultarDisponibilidadeEmailNovoCedente('inativo@example.com'))
      .resolves.toEqual({ outcome: 'ALREADY_EXISTS' })
  })

  it('percorre paginas sem assumir que a primeira contem todos os usuarios', async () => {
    mocks.listUsers
      .mockResolvedValueOnce({
        data: { users: Array.from({ length: 1000 }, (_, index) => ({ email: `user-${index}@example.com` })) },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { users: [{ email: 'alvo@example.com' }] },
        error: null,
      })

    await expect(consultarDisponibilidadeEmailNovoCedente('alvo@example.com'))
      .resolves.toEqual({ outcome: 'ALREADY_EXISTS' })
    expect(mocks.listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1000 })
  })

  it('falha fechado quando a Admin API retorna erro ou lanca excecao', async () => {
    mocks.listUsers.mockResolvedValueOnce({
      data: { users: [] },
      error: { code: 'service_unavailable', status: 503 },
    })
    await expect(consultarDisponibilidadeEmailNovoCedente('novo@example.com')).resolves.toEqual({
      outcome: 'LOOKUP_ERROR',
      providerCode: 'service_unavailable',
      status: 503,
    })

    mocks.listUsers.mockRejectedValueOnce({ code: 'network_error' })
    await expect(consultarDisponibilidadeEmailNovoCedente('novo@example.com')).resolves.toEqual({
      outcome: 'LOOKUP_ERROR',
      providerCode: 'network_error',
      status: null,
    })

    mocks.createAdminClient.mockImplementationOnce(() => {
      throw { code: 'admin_client_unavailable' }
    })
    await expect(consultarDisponibilidadeEmailNovoCedente('novo@example.com')).resolves.toEqual({
      outcome: 'LOOKUP_ERROR',
      providerCode: 'admin_client_unavailable',
      status: null,
    })
  })

  it('classifica email_exists do generateLink como defesa contra corrida', async () => {
    mocks.generateLink.mockResolvedValue({
      data: { user: null, properties: null },
      error: { code: 'email_exists', status: 422 },
    })

    await expect(gerarLinkAuthNovoCedente({ email: 'existente@example.com', appToken: 'a'.repeat(64) }))
      .rejects.toMatchObject({
        code: 'EMAIL_ALREADY_REGISTERED',
        providerCode: 'email_exists',
        status: 422,
      })
  })

  it('mantem erros inesperados do generateLink em categoria tecnica fechada', async () => {
    mocks.generateLink.mockResolvedValue({
      data: { user: null, properties: null },
      error: { code: 'service_unavailable', status: 503 },
    })

    await expect(gerarLinkAuthNovoCedente({ email: 'novo@example.com', appToken: 'a'.repeat(64) }))
      .rejects.toMatchObject({
        code: 'AUTH_GENERATE_LINK_FAILED',
        providerCode: 'service_unavailable',
        status: 503,
      })
  })
})
