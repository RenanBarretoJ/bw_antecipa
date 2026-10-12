import 'server-only'
import { z } from 'zod'
import { criptografarPortalFidcValor, descriptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'
import { IntakeError } from './contracts'
import type { GraphCredentials } from './providers/graph-http.server'

const scopeSchema = z.object({ integrationId: z.uuid(), fundoId: z.uuid(), purpose: z.enum(['GRAPH_CREDENTIAL', 'CURSOR', 'CLIENT_STATE']) })
export type SecretScope = z.infer<typeof scopeSchema>
export type ProtectedValue = { ciphertext: string; keyVersion: string }

/** Reuse the platform's versioned AES-GCM keyring; bind each value to its integration and purpose. */
export function protectValue(value: string, scope: SecretScope): ProtectedValue {
  if (!scopeSchema.safeParse(scope).success || !value) throw new IntakeError('CONFIGURATION')
  try {
    const encrypted = criptografarPortalFidcValor(JSON.stringify({ ...scope, value }))
    return { ciphertext: encrypted.ciphertext, keyVersion: encrypted.chaveVersao }
  } catch { throw new IntakeError('CONFIGURATION') }
}

export function revealValue(encrypted: ProtectedValue, scope: SecretScope): string {
  try {
    const payload = scopeSchema.extend({ value: z.string().min(1) }).parse(
      JSON.parse(descriptografarPortalFidcValor(encrypted.ciphertext, encrypted.keyVersion)))
    if (payload.integrationId !== scope.integrationId || payload.fundoId !== scope.fundoId || payload.purpose !== scope.purpose) {
      throw new IntakeError('CONFIGURATION')
    }
    return payload.value
  } catch { throw new IntakeError('CONFIGURATION') }
}

export function readTestCredentialsFromEnvironment(reference: string): GraphCredentials {
  if (!/^EMAIL_INTAKE_QA_[A-Z0-9_]{1,48}$/.test(reference)) throw new IntakeError('CONFIGURATION')
  const tenantId = process.env[`${reference}_TENANT_ID`]
  const clientId = process.env[`${reference}_CLIENT_ID`]
  const clientSecret = process.env[`${reference}_CLIENT_SECRET`]
  if (!tenantId || !clientId || !clientSecret) throw new IntakeError('CONFIGURATION')
  return { tenantId, clientId, clientSecret }
}
