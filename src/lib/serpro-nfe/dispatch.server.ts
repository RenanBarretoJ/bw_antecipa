import 'server-only'
import { after } from 'next/server'
import { readSerproNfeRuntimeConfig } from './provider.server'
import { runSerproNfeWorkerOnce } from './worker.server'

/** This is a latency hint, NOT delivery assurance. The transactional outbox is
 * authoritative; the protected recovery endpoint picks up missed hints/redeploys.
 * Its schedule must be installed separately under an activation GO. */
export function scheduleSerproNfePickup() {
  if (!readSerproNfeRuntimeConfig().ready) return
  try {
    after(async () => {
      try { await runSerproNfeWorkerOnce() }
      catch { console.warn('serpro_pickup', { state: 'RECOVERY_REQUIRED' }) }
    })
  } catch {
    // A non-request caller (e.g. a durable importer) cannot register after().
    // Its committed outbox still remains eligible for the managed recovery job.
    console.warn('serpro_pickup', { state: 'DURABLE_PICKUP_REQUIRED' })
  }
}
