import { beforeEach, describe, expect, it } from 'vitest'

import {
  limparTokenCache,
  obterTokenValidoCache,
  salvarTokenCache,
  tokenAindaValido,
} from './token-cache.server'

describe('tokenAindaValido', () => {
  it('considera valido quando falta mais que a margem de seguranca (120s)', () => {
    const expiraEm = 1_000_000
    expect(tokenAindaValido(expiraEm, expiraEm - 121_000)).toBe(true)
  })

  it('considera invalido dentro da margem de seguranca de 120s', () => {
    const expiraEm = 1_000_000
    expect(tokenAindaValido(expiraEm, expiraEm - 119_000)).toBe(false)
  })

  it('considera invalido exatamente na margem (limite exclusivo)', () => {
    const expiraEm = 1_000_000
    expect(tokenAindaValido(expiraEm, expiraEm - 120_000)).toBe(false)
  })

  it('considera invalido apos a expiracao', () => {
    const expiraEm = 1_000_000
    expect(tokenAindaValido(expiraEm, expiraEm + 1)).toBe(false)
  })
})

describe('cache de token Vortx VRS', () => {
  beforeEach(() => {
    limparTokenCache()
  })

  it('retorna null quando nao ha entrada em cache', () => {
    expect(obterTokenValidoCache({ fundoId: 'f1', ambiente: 'homologacao' })).toBeNull()
  })

  it('reutiliza o token salvo enquanto ainda estiver valido', () => {
    salvarTokenCache({ fundoId: 'f1', ambiente: 'homologacao' }, { accessToken: 'tok-1', expiraEm: 1_000_000 })
    const agora = 1_000_000 - 200_000
    expect(obterTokenValidoCache({ fundoId: 'f1', ambiente: 'homologacao' }, agora)).toBe('tok-1')
  })

  it('nao reutiliza o token proximo da expiracao (dentro da margem de 120s)', () => {
    salvarTokenCache({ fundoId: 'f1', ambiente: 'homologacao' }, { accessToken: 'tok-1', expiraEm: 1_000_000 })
    const agora = 1_000_000 - 100_000
    expect(obterTokenValidoCache({ fundoId: 'f1', ambiente: 'homologacao' }, agora)).toBeNull()
  })

  it('nao mistura credenciais entre fundos diferentes', () => {
    salvarTokenCache({ fundoId: 'f1', ambiente: 'homologacao' }, { accessToken: 'tok-f1', expiraEm: 1_000_000 })
    salvarTokenCache({ fundoId: 'f2', ambiente: 'homologacao' }, { accessToken: 'tok-f2', expiraEm: 1_000_000 })
    const agora = 1_000_000 - 200_000
    expect(obterTokenValidoCache({ fundoId: 'f1', ambiente: 'homologacao' }, agora)).toBe('tok-f1')
    expect(obterTokenValidoCache({ fundoId: 'f2', ambiente: 'homologacao' }, agora)).toBe('tok-f2')
  })

  it('nao mistura credenciais entre ambientes diferentes do mesmo fundo', () => {
    salvarTokenCache({ fundoId: 'f1', ambiente: 'homologacao' }, { accessToken: 'tok-homolog', expiraEm: 1_000_000 })
    salvarTokenCache({ fundoId: 'f1', ambiente: 'producao' }, { accessToken: 'tok-prod', expiraEm: 1_000_000 })
    const agora = 1_000_000 - 200_000
    expect(obterTokenValidoCache({ fundoId: 'f1', ambiente: 'homologacao' }, agora)).toBe('tok-homolog')
    expect(obterTokenValidoCache({ fundoId: 'f1', ambiente: 'producao' }, agora)).toBe('tok-prod')
  })

  it('limparTokenCache com chave especifica remove somente aquela entrada', () => {
    salvarTokenCache({ fundoId: 'f1', ambiente: 'homologacao' }, { accessToken: 'tok-1', expiraEm: 1_000_000 })
    salvarTokenCache({ fundoId: 'f2', ambiente: 'homologacao' }, { accessToken: 'tok-2', expiraEm: 1_000_000 })
    limparTokenCache({ fundoId: 'f1', ambiente: 'homologacao' })
    const agora = 1_000_000 - 200_000
    expect(obterTokenValidoCache({ fundoId: 'f1', ambiente: 'homologacao' }, agora)).toBeNull()
    expect(obterTokenValidoCache({ fundoId: 'f2', ambiente: 'homologacao' }, agora)).toBe('tok-2')
  })
})
