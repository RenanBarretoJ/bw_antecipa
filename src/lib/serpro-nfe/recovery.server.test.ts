import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { runSerproNfeRecoveryBatch, SERPRO_RECOVERY_LIMITS } from './recovery.server'

const complete = () => Promise.resolve({ processed: 1, status: 'INCONCLUSIVO' as const, severity: 'AMARELO' as const })
const ready = () => true

describe('bounded fiscal recovery without weakening the single-execution worker', () => {
  it('preserves the approved fixed limits', () => {
    expect(SERPRO_RECOVERY_LIMITS).toEqual({ maxExecutions: 15, admissionWindowMs: 120_000, executionReserveMs: 65_000 })
    expect(Object.isFrozen(SERPRO_RECOVERY_LIMITS)).toBe(true)
  })
  it('does not touch a worker when OFF', async () => {
    const runOnce = vi.fn(complete)
    expect(await runSerproNfeRecoveryBatch({ runOnce, isReady: () => false })).toMatchObject({ processed: 0, stopReason: 'RUNTIME_OFF' })
    expect(runOnce).not.toHaveBeenCalled()
  })
  it('processes at most 15 executions, sequentially', async () => {
    let active = 0, maximumActive = 0
    const runOnce = vi.fn(async () => {
      active++; maximumActive = Math.max(maximumActive, active)
      await Promise.resolve(); active--
      return complete()
    })
    expect(await runSerproNfeRecoveryBatch({ runOnce, isReady: ready })).toEqual({
      processed: 15, completed: 15, failed: 0, deferred: 0, stopReason: 'LIMIT_REACHED',
    })
    expect(runOnce).toHaveBeenCalledTimes(15)
    expect(maximumActive).toBe(1)
  })
  it('stops on no claim without claiming the database queue is empty', async () => {
    const runOnce = vi.fn(async () => ({ processed: 0, skipped: 'EMPTY_QUEUE' as const }))
    expect(await runSerproNfeRecoveryBatch({ runOnce, isReady: ready })).toMatchObject({ processed: 0, stopReason: 'NO_JOB_CLAIMED' })
    expect(runOnce).toHaveBeenCalledOnce()
  })
  it('checks the runtime kill switch between executions', async () => {
    let enabled = true
    const runOnce = vi.fn(async () => { enabled = false; return complete() })
    expect(await runSerproNfeRecoveryBatch({ runOnce, isReady: () => enabled })).toMatchObject({ processed: 1, stopReason: 'RUNTIME_OFF' })
    expect(runOnce).toHaveBeenCalledOnce()
  })
  it('also honors OFF returned by the existing worker', async () => {
    const runOnce = vi.fn(async () => ({ processed: 0, skipped: 'CAPABILITY_UNVERIFIED' as const }))
    expect(await runSerproNfeRecoveryBatch({ runOnce, isReady: ready })).toMatchObject({ stopReason: 'RUNTIME_OFF' })
    expect(runOnce).toHaveBeenCalledOnce()
  })
  it('does not admit a job with less than 65 seconds remaining', async () => {
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValue(55_001)
    const runOnce = vi.fn(complete)
    expect(await runSerproNfeRecoveryBatch({ runOnce, isReady: ready, monotonicNow: clock })).toMatchObject({ processed: 0, stopReason: 'ADMISSION_DEADLINE' })
    expect(runOnce).not.toHaveBeenCalled()
  })
  it('admits at the exact boundary, then stops without aborting the admitted execution', async () => {
    let time = 0
    const clock = vi.fn().mockImplementationOnce(() => 0).mockImplementation(() => time)
    time = 55_000
    const runOnce = vi.fn(async () => { time = 115_000; return complete() })
    expect(await runSerproNfeRecoveryBatch({ runOnce, isReady: ready, monotonicNow: clock })).toMatchObject({ processed: 1, stopReason: 'ADMISSION_DEADLINE' })
    expect(runOnce).toHaveBeenCalledOnce()
  })
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('fails closed on an invalid/regressing clock: %s', async value => {
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValue(value)
    const runOnce = vi.fn(complete)
    expect(await runSerproNfeRecoveryBatch({ runOnce, isReady: ready, monotonicNow: clock })).toMatchObject({ stopReason: 'INFRASTRUCTURE_ERROR' })
    expect(runOnce).not.toHaveBeenCalled()
  })
  it('retains partial counts and never retries infrastructure failures', async () => {
    const runOnce = vi.fn().mockImplementationOnce(complete).mockRejectedValueOnce(Error('do not expose'))
    expect(await runSerproNfeRecoveryBatch({ runOnce, isReady: ready })).toEqual({ processed: 1, completed: 1, failed: 0, deferred: 0, stopReason: 'INFRASTRUCTURE_ERROR' })
    expect(runOnce).toHaveBeenCalledTimes(2)
  })
  it('counts failed and deferred executions without repeating either', async () => {
    const runOnce = vi.fn().mockResolvedValueOnce({ processed: 1, status: 'INDISPONIVEL' })
      .mockResolvedValueOnce({ processed: 1, status: 'ERRO' })
      .mockResolvedValueOnce({ processed: 0, skipped: 'EMPTY_QUEUE' })
    expect(await runSerproNfeRecoveryBatch({ runOnce, isReady: ready })).toEqual({ processed: 2, completed: 0, failed: 1, deferred: 1, stopReason: 'EXECUTION_FAILED' })
    expect(runOnce).toHaveBeenCalledTimes(2)
  })
  it('overlapping batches process disjoint jobs through a shared authoritative claim, not an in-memory batch lock', async () => {
    const queue = Array.from({ length: 20 }, (_, index) => index)
    const seen: number[] = []
    const runOnce = async () => {
      const id = queue.shift()
      if (id === undefined) return { processed: 0, skipped: 'EMPTY_QUEUE' as const }
      await Promise.resolve(); seen.push(id)
      return complete()
    }
    const results = await Promise.all([1, 2].map(() => runSerproNfeRecoveryBatch({ runOnce, isReady: ready })))
    expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(20)
    expect(new Set(seen).size).toBe(20)
  })
})
