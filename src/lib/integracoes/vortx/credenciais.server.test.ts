import { beforeEach, describe, expect, it, vi } from 'vitest'

const { maybeSingle, eq, select, from, descriptografarPortalFidcValor, registrarEventoSeguranca } = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  descriptografarPortalFidcValor: vi.fn(),
  registrarEventoSeguranca: vi.fn(),
}))

vi.mock('@/lib/portal-fidc/credenciais', () => ({ descriptografarPortalFidcValor }))
vi.mock('@/lib/auth/mfa', () => ({ registrarEventoSeguranca }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))

import { resolverConfiguracaoVortxVrs } from './credenciais.server'

function mockAdminChain() {
  eq.mockReturnValue({ eq, maybeSingle })
  select.mockReturnValue({ eq })
  from.mockReturnValue({ select })
  return { from, select, eq, maybeSingle }
}

const admin = { from } as unknown as Parameters<typeof resolverConfiguracaoVortxVrs>[2]

describe('resolverConfiguracaoVortxVrs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminChain()
  })

  it('descriptografa key/secret/certificado/chave privada da credencial ativa', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        base_url: 'https://api-stg.vortx.com.br',
        key_criptografada: 'v1:key',
        secret_criptografada: 'v1:secret',
        certificado_criptografado: 'v1:cert',
        chave_privada_criptografada: 'v1:pk',
        chave_versao: 'v1',
      },
      error: null,
    })
    descriptografarPortalFidcValor
      .mockReturnValueOnce('key-plano')
      .mockReturnValueOnce('secret-plano')
      .mockReturnValueOnce('-----BEGIN CERTIFICATE-----')
      .mockReturnValueOnce('-----BEGIN PRIVATE KEY-----') // dummy fixture

    const result = await resolverConfiguracaoVortxVrs('fundo-1', 'homologacao', admin)

    expect(result).toEqual({
      fundoId: 'fundo-1',
      ambiente: 'homologacao',
      baseUrl: 'https://api-stg.vortx.com.br',
      key: 'key-plano',
      secret: 'secret-plano',
      credential: { certificadoPem: '-----BEGIN CERTIFICATE-----', chavePrivadaPem: '-----BEGIN PRIVATE KEY-----' }, // dummy fixture
    })
    expect(from).toHaveBeenCalledWith('integracoes_vortx_vrs_credenciais')
    expect(eq).toHaveBeenCalledWith('fundo_id', 'fundo-1')
    expect(eq).toHaveBeenCalledWith('ambiente', 'homologacao')
    expect(eq).toHaveBeenCalledWith('status', 'ativa')
  })

  it('lanca erro categoria autenticacao e registra evento de seguranca quando nao ha credencial ativa', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })

    await expect(resolverConfiguracaoVortxVrs('fundo-1', 'producao', admin)).rejects.toMatchObject({ categoria: 'autenticacao' })
    expect(registrarEventoSeguranca).toHaveBeenCalledWith(expect.objectContaining({
      tipo_evento: 'ACESSO_CREDENCIAL_NEGADO',
      dados: { fundo_id: 'fundo-1', ambiente: 'producao' },
    }))
  })

  it('propaga erro de consulta ao banco sem expor detalhes internos sensiveis', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'db down' } })
    await expect(resolverConfiguracaoVortxVrs('fundo-1', 'homologacao', admin)).rejects.toThrow(/Nao foi possivel resolver/)
  })
})
