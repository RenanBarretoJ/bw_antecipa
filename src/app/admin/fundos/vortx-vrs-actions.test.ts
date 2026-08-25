import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, requireSuperAdmin, autorizarEConsumirAcaoSensivel, criptografarPortalFidcValor, resolverConfiguracaoVortxVrs, autenticarVortxVrs, registrarEventoSeguranca, validarParMtls } = vi.hoisted(() => ({
  rpc: vi.fn(),
  requireSuperAdmin: vi.fn(async () => ({
    supabase: { rpc },
    user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    profile: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  })),
  autorizarEConsumirAcaoSensivel: vi.fn(),
  criptografarPortalFidcValor: vi.fn(),
  resolverConfiguracaoVortxVrs: vi.fn(),
  autenticarVortxVrs: vi.fn(),
  registrarEventoSeguranca: vi.fn(),
  validarParMtls: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/admin-authorization', () => ({ requireSuperAdmin }))
vi.mock('@/lib/auth/sensitive-action', () => ({ autorizarEConsumirAcaoSensivel }))
vi.mock('@/lib/auth/mfa', () => ({ registrarEventoSeguranca }))
vi.mock('@/lib/portal-fidc/credenciais', () => ({ criptografarPortalFidcValor }))
vi.mock('@/lib/integracoes/vortx/credenciais.server', () => ({ resolverConfiguracaoVortxVrs }))
vi.mock('@/lib/integracoes/vortx/vortx-vrs-client.server', () => ({ autenticarVortxVrs }))
vi.mock('@/lib/integracoes/vortx/mtls-credencial-validacao', async () => {
  const actual = await vi.importActual('@/lib/integracoes/vortx/mtls-credencial-validacao')
  return { ...actual, validarParMtls }
})

import { VortxCredencialValidacaoError } from '@/lib/integracoes/vortx/mtls-credencial-validacao'
import { configurarCredencialVortxVrsAdmin, testarConexaoVortxVrsAdmin } from './vortx-vrs-actions'

const fundoId = 'e84fdd30-39ed-de86-292e-0d8d9d92d759'
const CERT = '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----'
const KEY_PEM = '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----'

const credencialInput = {
  fundoId,
  ambiente: 'homologacao',
  baseUrl: 'https://api-stg.vortx.com.br',
  key: 'chave-cliente',
  secret: 'segredo-cliente',
  certificadoPem: CERT,
  chavePrivadaPem: KEY_PEM,
  mfaCode: '123456',
}

describe('configurarCredencialVortxVrsAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validarParMtls.mockReturnValue(undefined)
    criptografarPortalFidcValor.mockImplementation((value: string) => ({ ciphertext: `v1:enc:${value}`, chaveVersao: 'v1' }))
    rpc.mockResolvedValue({ data: { id: 'cred-1', fundo_id: fundoId, ambiente: 'homologacao' }, error: null })
  })

  it('exige Super Admin + fresh TOTP antes de criptografar e persistir', async () => {
    const result = await configurarCredencialVortxVrsAdmin(credencialInput)

    expect(result).toMatchObject({ success: true, data: { id: 'cred-1', ambiente: 'homologacao' } })
    expect(requireSuperAdmin).toHaveBeenCalled()
    expect(autorizarEConsumirAcaoSensivel).toHaveBeenCalledWith(expect.anything(), 'configurar_credencial_vortx_vrs', '123456')
    expect(rpc).toHaveBeenCalledWith('admin_configurar_credencial_vortx_vrs', expect.objectContaining({
      p_fundo_id: fundoId,
      p_ambiente: 'homologacao',
      p_base_url: credencialInput.baseUrl,
      p_key_criptografada: 'v1:enc:chave-cliente',
      p_secret_criptografada: 'v1:enc:segredo-cliente',
      p_certificado_criptografado: `v1:enc:${CERT}`,
      p_chave_privada_criptografada: `v1:enc:${KEY_PEM}`,
      p_chave_versao: 'v1',
    }))
  })

  it('rejeita entrada invalida sem chamar Super Admin nem criptografar nada', async () => {
    const result = await configurarCredencialVortxVrsAdmin({ ...credencialInput, baseUrl: 'http://sem-tls.com.br' })
    expect(result.success).toBe(false)
    expect(requireSuperAdmin).not.toHaveBeenCalled()
    expect(criptografarPortalFidcValor).not.toHaveBeenCalled()
  })

  it('rejeita certificado PEM sem os marcadores BEGIN/END CERTIFICATE', async () => {
    const result = await configurarCredencialVortxVrsAdmin({ ...credencialInput, certificadoPem: 'nao-e-pem' })
    expect(result.success).toBe(false)
    expect(requireSuperAdmin).not.toHaveBeenCalled()
  })

  it('rejeita chave privada PEM sem os marcadores BEGIN/END PRIVATE KEY', async () => {
    const result = await configurarCredencialVortxVrsAdmin({ ...credencialInput, chavePrivadaPem: 'nao-e-pem' })
    expect(result.success).toBe(false)
    expect(requireSuperAdmin).not.toHaveBeenCalled()
  })

  it('traduz erro 42501 da RPC em mensagem de acesso restrito', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Acesso administrativo negado' } })
    const result = await configurarCredencialVortxVrsAdmin(credencialInput)
    expect(result).toMatchObject({ success: false, message: 'Acesso restrito ao Super Admin.' })
  })

  it('valida o par certificado/chave privada ANTES de exigir Super Admin, criptografar ou chamar a RPC', async () => {
    validarParMtls.mockImplementation(() => {
      throw new VortxCredencialValidacaoError('O certificado mTLS e a chave privada nao correspondem.', 'VORTX_CREDENTIAL_CERT_KEY_MISMATCH')
    })

    const result = await configurarCredencialVortxVrsAdmin(credencialInput)

    expect(result).toMatchObject({ success: false, message: 'O certificado mTLS e a chave privada nao correspondem.' })
    expect(validarParMtls).toHaveBeenCalledWith(CERT, KEY_PEM)
    expect(requireSuperAdmin).not.toHaveBeenCalled()
    expect(criptografarPortalFidcValor).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reporta VORTX_CREDENTIAL_INVALID_PEM com mensagem sanitizada quando o certificado nao e um X.509 valido', async () => {
    validarParMtls.mockImplementation(() => {
      throw new VortxCredencialValidacaoError('O certificado mTLS informado nao e um PEM X.509 valido.', 'VORTX_CREDENTIAL_INVALID_PEM')
    })
    const result = await configurarCredencialVortxVrsAdmin(credencialInput)
    expect(result).toMatchObject({ success: false, message: 'O certificado mTLS informado nao e um PEM X.509 valido.' })
  })

  it('traduz falha inesperada na criptografia (VORTX_CREDENTIAL_ENCRYPTION_ERROR) sem vazar detalhe interno', async () => {
    criptografarPortalFidcValor.mockImplementation(() => { throw new Error('Chave de criptografia Portal FIDC nao configurada para a versao k1.') })

    const result = await configurarCredencialVortxVrsAdmin(credencialInput)

    expect(result).toMatchObject({ success: false, message: 'Nao foi possivel proteger a credencial Vortx VRS para salvamento. Tente novamente.' })
    expect(result.message).not.toContain('Chave de criptografia')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('traduz falha inesperada (nao-AuthorizationError) na confirmacao TOTP como VORTX_CREDENTIAL_TOTP_ERROR', async () => {
    autorizarEConsumirAcaoSensivel.mockRejectedValueOnce(new Error('erro de rede inesperado no desafio TOTP'))

    const result = await configurarCredencialVortxVrsAdmin(credencialInput)

    expect(result).toMatchObject({ success: false, message: 'Nao foi possivel confirmar a autorizacao TOTP para esta acao.' })
    expect(criptografarPortalFidcValor).not.toHaveBeenCalled()
  })

  it('nunca inclui Key/Secret/PEM/chave privada na mensagem retornada, mesmo em erro inesperado da RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'erro interno do banco' } })
    const result = await configurarCredencialVortxVrsAdmin(credencialInput)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(credencialInput.key)
    expect(serialized).not.toContain(credencialInput.secret)
    expect(serialized).not.toContain('fake')
  })
})

describe('testarConexaoVortxVrsAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolverConfiguracaoVortxVrs.mockResolvedValue({ fundoId, ambiente: 'homologacao', baseUrl: 'https://api-stg.vortx.com.br', key: 'k', secret: 's', credential: { certificadoPem: CERT, chavePrivadaPem: KEY_PEM } })
  })

  it('autentica e retorna ambiente + expiracao calculada, sem token/segredos no resultado', async () => {
    autenticarVortxVrs.mockResolvedValue({ accessToken: 'tok-secreto', refreshToken: 'ref', created: '2026-08-25T00:00:00.000Z', expiresIn: 3600 })

    const result = await testarConexaoVortxVrsAdmin({ fundoId, ambiente: 'homologacao', mfaCode: '654321' })

    expect(result.success).toBe(true)
    expect(result.data?.ambiente).toBe('homologacao')
    expect(result.data?.expiraEm).toBe('2026-08-25T01:00:00.000Z')
    expect(JSON.stringify(result)).not.toContain('tok-secreto')
    expect(autorizarEConsumirAcaoSensivel).toHaveBeenCalledWith(expect.anything(), 'testar_conexao_vortx_vrs', '654321')
    expect(registrarEventoSeguranca).toHaveBeenCalledWith(expect.objectContaining({ tipo_evento: 'CREDENCIAL_TESTADA' }))
  })

  it('traduz falha de autenticacao Vortx em mensagem sanitizada', async () => {
    autenticarVortxVrs.mockRejectedValue(Object.assign(new Error('Credenciais Vortx VRS invalidas.'), { categoria: 'autenticacao' }))
    const result = await testarConexaoVortxVrsAdmin({ fundoId, ambiente: 'homologacao', mfaCode: '654321' })
    expect(result).toMatchObject({ success: false, message: 'Credenciais Vortx VRS invalidas ou nao configuradas.' })
  })

  it('traduz timeout em mensagem sanitizada', async () => {
    autenticarVortxVrs.mockRejectedValue(Object.assign(new Error('Tempo limite excedido na requisicao mTLS.'), { categoria: 'timeout' }))
    const result = await testarConexaoVortxVrsAdmin({ fundoId, ambiente: 'homologacao', mfaCode: '654321' })
    expect(result).toMatchObject({ success: false, message: 'Tempo limite excedido ao conectar com a Vortx VRS.' })
  })

  it('nunca vaza o token de acesso mesmo em caminho de erro', async () => {
    autenticarVortxVrs.mockRejectedValue(new Error('falha inesperada com token=tok-secreto'))
    const result = await testarConexaoVortxVrsAdmin({ fundoId, ambiente: 'homologacao', mfaCode: '654321' })
    expect(JSON.stringify(result)).not.toContain('tok-secreto')
  })
})
