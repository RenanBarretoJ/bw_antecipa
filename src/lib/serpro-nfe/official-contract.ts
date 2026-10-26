export const SERPRO_NFE_TOKEN_URL = 'https://gateway.apiserpro.serpro.gov.br/token'

export const SERPRO_NFE_DF_SERVER_URL = 'https://gateway.apiserpro.serpro.gov.br/consulta-nfe-df/api/'

export const SERPRO_NFE_DF_PATH_PREFIX = 'v1/nfe/'

export const SERPRO_NFE_DF_QUERY_BASE_URL = new URL(
  SERPRO_NFE_DF_PATH_PREFIX,
  SERPRO_NFE_DF_SERVER_URL,
).toString()
