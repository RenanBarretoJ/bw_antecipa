import { z } from 'zod'
import { healthSnapshotSchema, alertCodeSchema } from '../automation/health'

const optionalUuid = z.uuid().nullable()
const date = z.iso.datetime({ offset: true }).nullable()
export const emailConfigurationSchema = z.object({
  name: z.string().trim().min(2).max(120), provider: z.literal('OUTLOOK_GRAPH'),
  environment: z.enum(['homologacao', 'producao']), mailbox: z.email().max(320).nullable(),
  mailboxObjectId: optionalUuid, folderId: z.string().trim().min(1).max(1024), credentialId: optionalUuid,
  routingMode: z.enum(['ALL_ACTIVE_CEDENTES', 'ALLOWLIST']), cedenteIds: z.array(z.uuid()).max(1000), startAt: date,
})
export type EmailConfiguration = z.infer<typeof emailConfigurationSchema>
export const credentialInputSchema = z.object({
  requestId: z.uuid(),
  fundoId: z.uuid(), name: z.string().trim().min(2).max(120), environment: z.enum(['homologacao', 'producao']),
  tenantId: z.uuid(), clientId: z.uuid(), clientSecret: z.string().min(1).max(8192), mfaCode: z.string().regex(/^\d{6}$/),
})
export const emailIntegrationSchema = emailConfigurationSchema.extend({
  id: z.uuid(), enabled: z.boolean(), configStatus: z.enum(['DRAFT', 'ACTIVE', 'DISABLED', 'ERROR']), revision: z.number().int(),
  testCompletedAt: date, testErrorCode: z.string().nullable(), testRevision: z.number().nullable(),
  healthStatus: z.enum(['HEALTHY', 'DEGRADED', 'ERROR', 'DISABLED']), healthCheckedAt: date,
  health: healthSnapshotSchema.nullable(),
  alerts: z.array(z.object({ code: alertCodeSchema, active: z.boolean(), firstSeen: z.string(), lastSeen: z.string(), resolvedAt: date })),
})
export type EmailIntegration = z.infer<typeof emailIntegrationSchema>
export const emailDashboardSchema = z.object({
  integrations: z.array(emailIntegrationSchema), canManageCredentials: z.boolean(),
  credentials: z.array(z.object({ id: z.uuid(), name: z.string(), provider: z.literal('OUTLOOK_GRAPH'),
    environment: z.enum(['homologacao', 'producao']), status: z.literal('ativa'), lastTestAt: date })),
})
export type EmailDashboard = z.infer<typeof emailDashboardSchema>
export const cedenteOptionsSchema = z.object({ total: z.number(), rows: z.array(z.object({ id: z.uuid(), name: z.string() })) })
export const inboxFilterSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().pipe(z.union([z.literal(25), z.literal(50)])).default(25),
  integrationId: optionalUuid.optional(), cedenteId: optionalUuid.optional(), since: date.optional(), until: date.optional(),
  status: z.enum(['ALL', 'REVIEW', 'ERROR', 'IMPORTED', 'DUPLICATE']).default('ALL'),
  reviewOnly: z.boolean().default(false),
  errorCode: z.string().regex(/^[A-Z_]{1,80}$/).optional(), documentType: z.enum(['NFE', 'NFSE']).optional(),
}).refine(value => !value.since || !value.until || Date.parse(value.since) <= Date.parse(value.until), {
  message: 'A data final deve ser igual ou posterior à data inicial.', path: ['until'],
})
export type InboxFilter = z.infer<typeof inboxFilterSchema>
export const inboxSchema = z.object({
  total: z.number(), page: z.number(), pageSize: z.number(), rows: z.array(z.object({
    id: z.uuid(), received_at: z.string(), subject_preview: z.string().nullable(), sender_masked: z.string().nullable(),
    discovery_source: z.string(), integration_name: z.string(), provider: z.string(), integration_id: z.uuid(),
    attachment_count: z.number(), imported: z.number(), duplicates: z.number(), review: z.number(), errors: z.number(), pending: z.number(),
  })),
})
export type EmailInbox = z.infer<typeof inboxSchema>
export const messageSchema = z.object({
  id: z.uuid(), receivedAt: z.string(), integrationId: z.uuid(), integrationName: z.string(), provider: z.string(),
  subject: z.string().nullable(), sender: z.string().nullable(), discoverySource: z.string(), total: z.number(), page: z.number(),
  attachments: z.array(z.object({
    id: z.uuid(), message_id: z.uuid(), file_name: z.string(), content_type: z.string(), size_bytes: z.number(), sha_preview: z.string().nullable(),
    status: z.string(), last_error_code: z.string().nullable(), attempts: z.number(), available_at: z.string(), completed_at: date,
    nota_fiscal_id: optionalUuid, cedente_id: optionalUuid, cedente_name: z.string().nullable(), review_intent_id: optionalUuid,
    document_type: z.string().nullable(), review_state: z.string().nullable(), review_available: z.boolean(), parser_strategy: z.string().nullable(),
  })),
})
export type EmailMessageDetail = z.infer<typeof messageSchema>
export type OperatorResult<T> = { ok: true; data: T } | { ok: false; message: string }

export function activationMissing(row: EmailIntegration, now = Date.now()): string[] {
  const missing: string[] = []
  if (!row.credentialId) missing.push('Selecione uma credencial ativa.')
  if (!row.mailbox || !row.mailboxObjectId) missing.push('Complete os dados da caixa de e-mail.')
  if (row.routingMode === 'ALLOWLIST' && !row.cedenteIds.length) missing.push('Selecione pelo menos um cedente.')
  if (!row.startAt || Date.parse(row.startAt) > now) missing.push('Defina uma data inicial que não esteja no futuro.')
  if (!row.testCompletedAt || row.testRevision !== row.revision || row.testErrorCode || now - Date.parse(row.testCompletedAt) > 30 * 60_000) missing.push('Teste a conexão nesta configuração antes de ativar.')
  return missing
}
