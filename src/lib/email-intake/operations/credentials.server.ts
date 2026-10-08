import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { descriptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'
import { IntakeError, type EmailProviderAdapter } from '../contracts'
import { GraphHttpClient } from '../providers/graph-http.server'
import { OutlookGraphAdapter } from '../providers/outlook-graph.server'

const materialSchema = z.object({
  integrationId: z.uuid(), fundoId: z.uuid(), mailbox: z.email(), objectId: z.uuid(), folderId: z.string().min(1),
  identityCiphertext: z.string(), secretCiphertext: z.string(), keyVersion: z.string(),
})
const identitySchema = z.object({ tenantId: z.uuid(), clientId: z.uuid() })

/** Trusted jobs or an already authorized operator may resolve the existing vault. Never return this to a browser. */
export async function resolveEmailCredential(integrationId: string, fundoId: string, client = createAdminClient()) {
  try {
    const { data, error } = await client.rpc('email_credential_material', { p_id: integrationId })
    if (error) throw new IntakeError('CONFIGURATION')
    const material = materialSchema.parse(data)
    if (material.integrationId !== integrationId || material.fundoId !== fundoId) throw new IntakeError('ACCESS_DENIED')
    const identity = identitySchema.parse(JSON.parse(descriptografarPortalFidcValor(material.identityCiphertext, material.keyVersion)))
    const clientSecret = descriptografarPortalFidcValor(material.secretCiphertext, material.keyVersion)
    return { http: new GraphHttpClient({ ...identity, clientSecret }), tenantId: identity.tenantId,
      mailbox: material.mailbox, objectId: material.objectId, folderId: material.folderId }
  } catch (error) {
    if (error instanceof IntakeError) throw error
    throw new IntakeError('CONFIGURATION')
  }
}

/** One resolution per job, preserving the synchronous factory and all certified workers. */
export function createVaultEmailProvider(integrationId: string, fundoId: string): EmailProviderAdapter {
  let pending: Promise<OutlookGraphAdapter> | undefined
  const adapter = () => pending ??= resolveEmailCredential(integrationId, fundoId)
    .then(({ http, mailbox, folderId }) => new OutlookGraphAdapter(http, mailbox, folderId))
  return {
    testConnection: async () => (await adapter()).testConnection(),
    createOrRenewSubscription: async input => (await adapter()).createOrRenewSubscription(input),
    findSubscription: async input => (await adapter()).findSubscription(input),
    deleteSubscription: async id => (await adapter()).deleteSubscription(id),
    syncMessages: async (cursor, start) => (await adapter()).syncMessages(cursor, start),
    reconcileMessages: async (cursor, since) => (await adapter()).reconcileMessages(cursor, since),
    getMessage: async id => (await adapter()).getMessage(id),
    listAttachments: async id => (await adapter()).listAttachments(id),
    downloadAttachment: async (message, attachment) => (await adapter()).downloadAttachment(message, attachment),
    normalizeExternalIdentity: id => {
      if (!id || id.length > 2048 || id.trim() !== id) throw new IntakeError('INVALID_RESPONSE')
      return id
    },
  }
}

export async function testEmailMailbox(integrationId: string, fundoId: string) {
  const { http, mailbox, objectId, folderId, tenantId } = await resolveEmailCredential(integrationId, fundoId)
  // Mail.Read permits folder reads by object ID without requiring directory-wide User.Read.All.
  const folderSchema = z.object({ id: z.string().min(1) })
  const suffix = `/mailFolders/${encodeURIComponent(folderId)}?$select=id`
  const byId = await http.json(`/v1.0/users/${encodeURIComponent(objectId)}${suffix}`, folderSchema)
  const byAddress = await http.json(`/v1.0/users/${encodeURIComponent(mailbox)}${suffix}`, folderSchema)
  if (byId.id !== byAddress.id) throw new IntakeError('ACCESS_DENIED')
  await new OutlookGraphAdapter(http, mailbox, folderId).testConnection()
  return tenantId
}
