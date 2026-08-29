import { z } from 'zod'

export type VortxAmbiente = 'homologacao' | 'producao'

// PostgreSQL aceita o formato canonico do tipo uuid sem exigir os bits de
// versao e variante da RFC. Parte dos IDs legados do projeto usa esse formato.
const POSTGRES_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuid = z.string().trim().regex(POSTGRES_UUID_PATTERN, 'Identificador invalido.')
const mfaCode = z.string().regex(/^\d{6}$/, 'Informe o codigo TOTP de 6 digitos.')
const ambiente = z.enum(['homologacao', 'producao'])

const pemCertificado = z.string().trim().min(1).refine(
  (value) => value.includes('-----BEGIN CERTIFICATE-----') && value.includes('-----END CERTIFICATE-----'),
  'Certificado PEM invalido.',
)
const pemChavePrivada = z.string().trim().min(1).refine(
  (value) => /-----BEGIN (RSA )?PRIVATE KEY-----/.test(value) && /-----END (RSA )?PRIVATE KEY-----/.test(value),
  'Chave privada PEM invalida.',
)

export const vortxCredencialSchema = z.object({
  fundoId: uuid,
  ambiente,
  baseUrl: z.string().trim().url().refine((value) => value.startsWith('https://'), 'Informe uma URL HTTPS valida.'),
  key: z.string().trim().min(1).max(300),
  secret: z.string().min(1).max(1000),
  certificadoPem: pemCertificado,
  chavePrivadaPem: pemChavePrivada,
  mfaCode,
})

export const vortxTesteConexaoSchema = z.object({
  fundoId: uuid,
  ambiente,
  mfaCode,
})

export type VortxConfiguracaoStatus = {
  id: string
  ambiente: VortxAmbiente
  base_url: string
  status: 'ativa' | 'revogada'
  criada_em: string
  revogada_em: string | null
}

export type VortxActionResult = {
  success: boolean
  message: string
  data?: { id?: string; ambiente?: VortxAmbiente; expiraEm?: string }
}
