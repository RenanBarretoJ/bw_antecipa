import { describe, expect, it } from 'vitest'
import {
  isLegacyEnvSinqiaTerraConfig,
  resolverLegacyEnvSinqiaTerra,
} from './legacy-env'

describe('compatibilidade Sinqia/Terra por env', () => {
  it('somente habilita o modo quando declarado explicitamente', () => {
    expect(isLegacyEnvSinqiaTerraConfig({ runtime_mode: 'legacy_env_sinqia_terra' }, '7a114257-7816-468e-adf4-d796b93364df')).toBe(true)
    expect(isLegacyEnvSinqiaTerraConfig({ runtime_mode: 'legacy_env_sinqia_terra' }, 'cb372689-65c8-43af-8a20-7438002a3b91')).toBe(false)
    expect(isLegacyEnvSinqiaTerraConfig({}, '7a114257-7816-468e-adf4-d796b93364df')).toBe(false)
  })

  it('resolve as quatro envs sem expor ou transformar credenciais', () => {
    expect(resolverLegacyEnvSinqiaTerra({
      FROMTIS_URL: 'https://portal.example.test/ws',
      FROMTIS_USERNAME: 'usuario',
      FROMTIS_PASSWORD: 'segredo',
      FROMTIS_TIPO_RECEBIVEL: '07',
    })).toEqual({
      endpoint: 'https://portal.example.test/ws',
      username: 'usuario',
      password: 'segredo',
      tipoRecebivel: '07',
    })
  })

  it('falha fechada quando env obrigatoria, HTTPS ou tipo de recebivel forem invalidos', () => {
    expect(() => resolverLegacyEnvSinqiaTerra({})).toThrow('exige FROMTIS_URL')
    expect(() => resolverLegacyEnvSinqiaTerra({
      FROMTIS_URL: 'http://portal.example.test', FROMTIS_USERNAME: 'u', FROMTIS_PASSWORD: 'p',
    })).toThrow('HTTPS')
    expect(() => resolverLegacyEnvSinqiaTerra({
      FROMTIS_URL: 'https://portal.example.test', FROMTIS_USERNAME: 'u', FROMTIS_PASSWORD: 'p', FROMTIS_TIPO_RECEBIVEL: '1',
    })).toThrow('dois digitos')
  })
})
