import { z } from 'zod'
import { providerConfigurationSchema } from '../provider-factory.server'

export const jobKindSchema = z.enum(['DELTA', 'RECONCILIATION', 'SUBSCRIPTION'])
export type JobKind = z.infer<typeof jobKindSchema>
export const automationJobSchema = providerConfigurationSchema.extend({
  token: z.uuid(), kind: jobKindSchema, tenantId: z.uuid(), mailboxObjectId: z.uuid(),
  resource: z.string().min(1), subscriptionId: z.string().nullable(), subscriptionStatus: z.string(),
  subscriptionExpiresAt: z.string().nullable(), clientStateCiphertext: z.string().nullable(),
  clientStateKeyVersion: z.string().nullable(), attempt: z.number().int().positive(), startAt: z.string(),
  discoveryToken: z.uuid().optional(), revision: z.number().int().nonnegative().optional(),
  cursorCiphertext: z.string().nullable().optional(), cursorKeyVersion: z.string().nullable().optional(),
})
export type AutomationJob = z.infer<typeof automationJobSchema>
