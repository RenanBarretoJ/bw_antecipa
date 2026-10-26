import { describe, expect, it } from 'vitest'
import { verifyLocalContract } from '@/test/email03-local-contracts.mjs'

describe('DANFE draft through official local Auth/MFA/RPC/Storage', () => {
  it('requires a human due date and preserves original, tenant scope and pending documentary policy', async () => {
    const proof = await verifyLocalContract('DANFE_DRAFT')
    expect(proof.status).toBe('PASS')
    expect(proof.nativeAuth).toBe(true)
    expect(proof.checks).toContain('NO_INVENTED_NET_OR_PARCEL')
    expect(proof.checks).toContain('ORIGINAL_PDF_BYTES_RETAINED')
    expect(proof.checks).toContain('FUND_DOCUMENT_REQUIREMENTS_STILL_PENDING')
  }, 60000)
})
