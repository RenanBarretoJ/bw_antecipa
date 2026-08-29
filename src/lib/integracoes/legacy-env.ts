export const LEGACY_ENV_SINQIA_TERRA_MODE = 'legacy_env_sinqia_terra'
export const DLZ_HEALTH_PRODUCTION_FUND_ID = '7a114257-7816-468e-adf4-d796b93364df'

export interface LegacyEnvSinqiaTerraConfig {
  endpoint: string
  username: string
  password: string
  tipoRecebivel: string
}

export function isLegacyEnvSinqiaTerraConfig(config: Record<string, unknown>, fundoId: string): boolean {
  return fundoId === DLZ_HEALTH_PRODUCTION_FUND_ID
    && config.runtime_mode === LEGACY_ENV_SINQIA_TERRA_MODE
}

export function resolverLegacyEnvSinqiaTerra(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): LegacyEnvSinqiaTerraConfig {
  const endpoint = env.FROMTIS_URL?.trim()
  const username = env.FROMTIS_USERNAME?.trim()
  const password = env.FROMTIS_PASSWORD
  const tipoRecebivel = env.FROMTIS_TIPO_RECEBIVEL?.trim() || '01'

  if (!endpoint || !username || !password) {
    throw new Error('A integracao legada Sinqia/Terra exige FROMTIS_URL, FROMTIS_USERNAME e FROMTIS_PASSWORD no runtime.')
  }
  if (!/^https:\/\//iu.test(endpoint)) {
    throw new Error('FROMTIS_URL deve usar HTTPS no runtime legado Sinqia/Terra.')
  }
  if (!/^\d{2}$/u.test(tipoRecebivel)) {
    throw new Error('FROMTIS_TIPO_RECEBIVEL deve conter exatamente dois digitos.')
  }

  return { endpoint, username, password, tipoRecebivel }
}
