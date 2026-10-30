import 'server-only'
import { readSerproNfeRuntimeConfig } from './provider.server'
import { runSerproNfeWorkerOnce } from './worker.server'

export const SERPRO_RECOVERY_LIMITS = Object.freeze({
  maxExecutions: 15,
  admissionWindowMs: 120_000,
  executionReserveMs: 65_000,
})

type WorkerResult = Awaited<ReturnType<typeof runSerproNfeWorkerOnce>>
export type RecoveryStopReason =
  | 'LIMIT_REACHED' | 'ADMISSION_DEADLINE' | 'RUNTIME_OFF'
  | 'NO_JOB_CLAIMED' | 'INFRASTRUCTURE_ERROR' | 'EXECUTION_FAILED'

export interface SerproRecoveryResult {
  processed: number
  completed: number
  failed: number
  deferred: number
  stopReason: RecoveryStopReason
}

/** Bounded draining, not HTTP retries. Each iteration uses the existing claim,
 * lease and credential-wide outbound fence. Concurrent invocations do not share
 * process-local locks; SQL remains authoritative. Never preclaim an entire batch. */
export async function runSerproNfeRecoveryBatch(dependencies: {
  runOnce?: () => Promise<WorkerResult>
  isReady?: () => boolean
  monotonicNow?: () => number
} = {}): Promise<SerproRecoveryResult> {
  const runOnce = dependencies.runOnce ?? runSerproNfeWorkerOnce
  const isReady = dependencies.isReady ?? (() => readSerproNfeRuntimeConfig().ready)
  const clock = dependencies.monotonicNow ?? (() => performance.now())
  const startedAt = clock()
  const result: SerproRecoveryResult = {
    processed: 0, completed: 0, failed: 0, deferred: 0, stopReason: 'LIMIT_REACHED',
  }
  let previousTime = startedAt
  while (result.processed < SERPRO_RECOVERY_LIMITS.maxExecutions) {
    if (!isReady()) return { ...result, stopReason: 'RUNTIME_OFF' }
    const currentTime = clock()
    if (!Number.isFinite(startedAt) || !Number.isFinite(currentTime) || currentTime < previousTime) {
      return { ...result, stopReason: 'INFRASTRUCTURE_ERROR' }
    }
    previousTime = currentTime
    if (SERPRO_RECOVERY_LIMITS.admissionWindowMs - (currentTime - startedAt)
      < SERPRO_RECOVERY_LIMITS.executionReserveMs) {
      return { ...result, stopReason: 'ADMISSION_DEADLINE' }
    }
    let execution: WorkerResult
    try { execution = await runOnce() }
    catch { return { ...result, stopReason: 'INFRASTRUCTURE_ERROR' } }
    if (execution.processed === 0) {
      return { ...result, stopReason: execution.skipped === 'CAPABILITY_UNVERIFIED'
        ? 'RUNTIME_OFF' : 'NO_JOB_CLAIMED' }
    }
    result.processed++
    // The single-execution worker intentionally exposes no infrastructure text.
    // Stop conservatively on any terminal failure rather than guessing its cause.
    if (execution.status === 'ERRO') {
      result.failed++
      return { ...result, stopReason: 'EXECUTION_FAILED' }
    }
    else if (execution.status === 'INDISPONIVEL') result.deferred++
    else result.completed++
  }
  return result
}
