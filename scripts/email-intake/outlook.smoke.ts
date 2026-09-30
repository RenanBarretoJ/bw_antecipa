import { readFile, writeFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { IntakeError } from '../../src/lib/email-intake/contracts'
import { readTestCredentialsFromEnvironment } from '../../src/lib/email-intake/secrets.server'
import { GraphHttpClient } from '../../src/lib/email-intake/providers/graph-http.server'
import { OutlookGraphAdapter } from '../../src/lib/email-intake/providers/outlook-graph.server'

it('checks client credentials and minimal mailbox metadata without imports or subscriptions', async () => {
  if (process.env.EMAIL_INTAKE_SCOPE_CONFIRMED !== 'true'
    || !z.email().safeParse(process.env.EMAIL_INTAKE_SMOKE_MAILBOX).success) {
    throw new Error('Set the confirmed mailbox and scope attestation before this opt-in smoke.')
  }
  const stages: { stage: 'AUTH' | 'MAILBOX'; status: number }[] = []
  let result = 'NOT_RUN'
  const started = Date.now()
  try {
    const env = parseEnv(await readFile('.env.email-intake.local', 'utf8'))
    for (const suffix of ['TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET']) {
      const name = `EMAIL_INTAKE_QA_RLX_${suffix}`
      if (!env[name]?.trim()) throw new IntakeError('CONFIGURATION')
      process.env[name] = env[name]
    }
    const credentials = readTestCredentialsFromEnvironment('EMAIL_INTAKE_QA_RLX')
    const checkedFetch: typeof fetch = async (url, init) => {
      const target = new URL(String(url))
      const stage = target.hostname === 'login.microsoftonline.com' ? 'AUTH' : 'MAILBOX'
      if ((stage === 'AUTH' && (target.hostname !== 'login.microsoftonline.com' || init?.method !== 'POST'))
        || (stage === 'MAILBOX' && (target.hostname !== 'graph.microsoft.com'
          || (init?.method ?? 'GET') !== 'GET' || target.searchParams.get('$top') !== '1'
          || target.searchParams.get('$select') !== 'id,receivedDateTime,hasAttachments'))) {
        throw new IntakeError('CONFIGURATION')
      }
      const response = await fetch(url, init)
      stages.push({ stage, status: response.status })
      return response
    }
    const adapter = new OutlookGraphAdapter(new GraphHttpClient(credentials, { fetch: checkedFetch }),
      process.env.EMAIL_INTAKE_SMOKE_MAILBOX!)
    await adapter.testConnection()
    result = 'PASS'
  } catch (error) {
    result = error instanceof IntakeError ? error.code : 'LOCAL_CONFIGURATION_OR_RUNTIME'
  } finally {
    for (const suffix of ['TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET']) delete process.env[`EMAIL_INTAKE_QA_RLX_${suffix}`]
  }
  // Only closed status codes and timings. Never print tokens, IDs, message metadata or provider bodies.
  const evidence = { result, checkedAt: new Date().toISOString(), stages, durationMs: Date.now() - started,
    mailboxScope: 'USER_CONFIRMED_NOT_INDEPENDENTLY_VERIFIED',
    attachmentsDownloaded: 0, subscriptionsCreated: 0, databaseWrites: 0 }
  await writeFile('docs/homologacao/rlx-email-connection.json', `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.info(JSON.stringify(evidence))
  expect(result).toBe('PASS')
})
