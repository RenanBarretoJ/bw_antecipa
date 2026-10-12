import 'server-only'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { createEmailGraphClient, providerConfigurationSchema } from '../provider-factory.server'
import { safeEmailSubject, maskEmailSender } from './metadata'
import { IntakeError } from '../contracts'

const sourceSchema = z.array(providerConfigurationSchema.extend({ messages: z.array(z.object({ id: z.uuid(), externalId: z.string().min(1).max(2048) })).max(50) })).max(50)
const batchSchema = z.object({ responses: z.array(z.object({ id: z.string(), status: z.number(), body: z.unknown() })).max(20) })
const detailSchema = z.object({ subject: z.string().max(65536).optional(), sender: z.object({ emailAddress: z.object({ address: z.string().optional() }) }).optional() })

/** Called only after email_operator_begin_metadata has authorized every requested message. */
export async function refreshEmailMetadata(fundoId: string, token: string) {
  const admin = createAdminClient()
  const source = await admin.rpc('email_operator_metadata_source', { p_fundo: fundoId, p_token: token })
  if (source.error) throw new IntakeError('CONFIGURATION')
  const integrations = sourceSchema.parse(source.data)
  let updated = 0, failed = 0
  for (const config of integrations) {
    if (config.fundoId !== fundoId) throw new IntakeError('ACCESS_DENIED')
    let processed = 0
    try {
      const http = await createEmailGraphClient(config)
      for (let offset = 0; offset < config.messages.length; offset += 20) {
        const messages = config.messages.slice(offset, offset + 20)
        const batch = await http.json('/v1.0/$batch', batchSchema, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests: messages.map((message, index) => ({ id: String(index), method: 'GET',
            url: `/users/${encodeURIComponent(config.mailbox)}/messages/${encodeURIComponent(message.externalId)}?$select=subject,sender`,
            headers: { Prefer: 'IdType="ImmutableId"' } })) }) })
        const rows: { id: string; subject: string; sender: string }[] = []
        for (let index = 0; index < messages.length; index++) {
          const response = batch.responses.find(item => item.id === String(index))
          const detail = detailSchema.safeParse(response?.body)
          if (response?.status !== 200 || !detail.success) continue
          rows.push({ id: messages[index].id, subject: safeEmailSubject(detail.data.subject ?? ''), sender: maskEmailSender(detail.data.sender?.emailAddress.address) })
        }
        if (rows.length) {
          const saved = await admin.rpc('email_operator_complete_metadata', { p_token: token, p_rows: rows })
          if (saved.error) throw new IntakeError('CONFIGURATION')
          updated += saved.data
          failed += messages.length - saved.data
        } else failed += messages.length
        processed += messages.length
      }
    } catch { failed += config.messages.length - processed }
  }
  return { updated, failed }
}
