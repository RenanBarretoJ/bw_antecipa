import 'server-only'
import { z } from 'zod'
import { IntakeError, type EmailProviderAdapter } from './contracts'
import { GraphHttpClient } from './providers/graph-http.server'
import { OutlookGraphAdapter } from './providers/outlook-graph.server'
import { readTestCredentialsFromEnvironment, revealValue } from './secrets.server'

export const providerConfigurationSchema = z.object({
  integrationId: z.uuid(), fundoId: z.uuid(), provider: z.literal('OUTLOOK_GRAPH'),
  mailbox: z.email(), folderId: z.string().min(1), credentialEnvRef: z.string().nullable(),
  credentialCiphertext: z.string().nullable(), credentialKeyVersion: z.string().nullable(),
})
const credentialsSchema = z.object({ tenantId: z.uuid(), clientId: z.uuid(), clientSecret: z.string().min(1) })

/** Configuration stays server-side for processing and the official human review. */
export function createEmailProvider(config: z.infer<typeof providerConfigurationSchema>): EmailProviderAdapter {
  const credentials = config.credentialEnvRef ? readTestCredentialsFromEnvironment(config.credentialEnvRef)
    : config.credentialCiphertext && config.credentialKeyVersion ? credentialsSchema.parse(JSON.parse(revealValue({
      ciphertext: config.credentialCiphertext, keyVersion: config.credentialKeyVersion,
    }, { integrationId: config.integrationId, fundoId: config.fundoId, purpose: 'GRAPH_CREDENTIAL' }))) : null
  if (!credentials) throw new IntakeError('CONFIGURATION')
  return new OutlookGraphAdapter(new GraphHttpClient(credentials), config.mailbox, config.folderId)
}
