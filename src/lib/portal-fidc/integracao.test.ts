import { describe, expect, it } from 'vitest'
import {
  mapearStatusPortalFidc,
  portalFidcCredentialEnvName,
  resolverCredenciaisPortalFidc,
  sha256Hex,
} from '@/lib/portal-fidc/integracao'

describe('Portal FIDC integration helpers', () => {
  it('monta nomes de variaveis por credential_ref sem usar credencial global implicita', () => {
    expect(portalFidcCredentialEnvName('portal_fidc_fundo_abc_homologacao', 'USERNAME')).toBe('PORTAL_FIDC_CREDENTIAL_PORTAL_FIDC_FUNDO_ABC_HOMOLOGACAO_USERNAME')
    expect(portalFidcCredentialEnvName('portal fidc/fundo-abc', 'PASSWORD')).toBe('PORTAL_FIDC_CREDENTIAL_PORTAL_FIDC_FUNDO_ABC_PASSWORD')
  })

  it('nao retorna segredo nem valor de variavel em erro de credencial ausente', () => {
    const ref = 'portal_fidc_sem_secret'
    delete process.env[portalFidcCredentialEnvName(ref, 'USERNAME')]
    delete process.env[portalFidcCredentialEnvName(ref, 'PASSWORD')]

    expect(() => resolverCredenciaisPortalFidc({ credentialRef: ref, secretName: null })).toThrow(/referencia portal_fidc_sem_secret/i)
  })

  it('resolve credenciais apenas pela referencia configurada', () => {
    const ref = 'portal_fidc_teste'
    process.env[portalFidcCredentialEnvName(ref, 'USERNAME')] = 'usuario-teste'
    process.env[portalFidcCredentialEnvName(ref, 'PASSWORD')] = 'senha-teste'

    expect(resolverCredenciaisPortalFidc({ credentialRef: ref, secretName: null })).toEqual({
      username: 'usuario-teste',
      password: 'senha-teste',
    })

    delete process.env[portalFidcCredentialEnvName(ref, 'USERNAME')]
    delete process.env[portalFidcCredentialEnvName(ref, 'PASSWORD')]
  })

  it('mapeia estados externos conhecidos e preserva desconhecidos como pendentes', () => {
    expect(mapearStatusPortalFidc('Arquivo processado com sucesso')).toMatchObject({ statusInterno: 'aceita', pendente: false })
    expect(mapearStatusPortalFidc('Remessa rejeitada pelo administrador')).toMatchObject({ statusInterno: 'rejeitada', pendente: false })
    expect(mapearStatusPortalFidc('Em processamento')).toMatchObject({ statusInterno: 'enviada', pendente: true })
    expect(mapearStatusPortalFidc('Status XYZ nao catalogado')).toMatchObject({ statusInterno: 'enviada', pendente: true, statusExterno: 'Status XYZ nao catalogado' })
  })

  it('gera hash sha256 deterministico para idempotencia e auditoria', () => {
    expect(sha256Hex('portal-fidc')).toBe(sha256Hex('portal-fidc'))
    expect(sha256Hex('portal-fidc')).toHaveLength(64)
  })
})
