import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractDanfseV2 } from './danfse-v2'
import { danfseFixture } from './fixtures/danfse-v2'
import { fiscalFingerprint, sha256 } from './review-facts'
import { claimNfseReview, openNfseReview, readNfseReview, settleNfseReview, type NfseReviewIntent } from './review-intents.server'

const { rows, client } = vi.hoisted(() => {
  const rows: Record<string, unknown>[] = []
  const client = { from: vi.fn(() => {
    let patch: Record<string, unknown> | undefined
    const filters: ((row: Record<string, unknown>) => boolean)[] = []
    const result = () => {
      const row = rows.find(row => filters.every(filter => filter(row)))
      if (row && patch) {
        if (patch.state === 'PROCESSING' && rows.some(other => other !== row && other.identity_sha256 === row.identity_sha256
          && ['PROCESSING','COMPLETED','CLEANUP_PENDING'].includes(String(other.state)))) return { data: null, error: { code: '23505' } }
        Object.assign(row, patch)
      }
      return { data: row ? { ...row } : null, error: null }
    }
    const chain = {
      insert: (input: Record<string, unknown>) => { rows.push({ ...input, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', state: 'REVIEW', expires_at: '2099-01-01' }); return chain },
      update: (input: Record<string, unknown>) => { patch = input; return chain },
      select: () => chain,
      eq: (field: string, value: unknown) => { filters.push(row => row[field] === value); return chain },
      gt: (field: string, value: string) => { filters.push(row => String(row[field]) > value); return chain },
      single: async () => result(), maybeSingle: async () => result(),
    }
    return chain
  }) }
  return { rows, client }
})
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => client }))
const scope = { actorId: 'actor', cedenteId: 'cedente', cedenteFundoId: 'link', fundoId: 'fund' }
const extraction = () => extractDanfseV2(danfseFixture())
const hash = sha256('original-pdf')

beforeEach(() => { rows.length = 0; vi.clearAllMocks() })
describe('server-owned NFS-e review receipts', () => {
  it('binds the original document, actor and operational context without storing fiscal PII', async () => {
    const id = await openNfseReview(scope, extraction(), hash)
    expect(await readNfseReview(id, scope, extraction(), hash)).toMatchObject({ file_sha256: hash, state: 'REVIEW' })
    expect(rows[0]).not.toHaveProperty('dados')
    for (const field of ['actorId','cedenteId','cedenteFundoId','fundoId'] as const) {
      await expect(readNfseReview(id, { ...scope, [field]: 'other' }, extraction(), hash)).rejects.toThrow('INVALID')
    }
  })
  it('fails closed on changed file or material fiscal facts', async () => {
    const id = await openNfseReview(scope, extraction(), hash)
    await expect(readNfseReview(id, scope, extraction(), sha256('other-pdf'))).rejects.toThrow('DRIFT')
    for (const field of ['valor_bruto','valor_liquido','numero_nf','chave_acesso','data_emissao','competencia','cnpj_emitente','cnpj_destinatario'] as const) {
      const changed = extraction()
      Object.assign(changed.dados, { [field]: typeof changed.dados[field] === 'number' ? 1 : 'changed' })
      await expect(readNfseReview(id, scope, changed, hash)).rejects.toThrow('DRIFT')
    }
    expect(rows[0].state).toBe('REVIEW')
  })
  it('does not use strategy as fiscal identity', async () => {
    const text = extraction(), visual = { ...text, strategy: 'danfse_v2_visual' as const }
    expect(fiscalFingerprint(visual)).toBe(fiscalFingerprint(text))
    await openNfseReview(scope, text, hash)
    const identity = rows[0].identity_sha256
    await openNfseReview(scope, visual, sha256('visual-pdf'))
    expect(rows[1].identity_sha256).toBe(identity)
  })
  it('rejects expiry, malformed ids and replay of a completed receipt', async () => {
    const id = await openNfseReview(scope, extraction(), hash)
    await expect(readNfseReview('bad', scope, extraction(), hash)).rejects.toThrow('INVALID')
    rows[0].expires_at = '2000-01-01'
    await expect(readNfseReview(id, scope, extraction(), hash)).rejects.toThrow('EXPIRED')
    rows[0].state = 'COMPLETED'
    await expect(readNfseReview(id, scope, extraction(), hash)).rejects.toThrow('CONFLICT')
  })
  it('admits exactly one concurrent worker before Storage', async () => {
    const id = await openNfseReview(scope, extraction(), hash)
    const results = await Promise.allSettled([claimNfseReview(id, 'path-a', 'nf'), claimNfseReview(id, 'path-b', 'nf')])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(rows[0]).toMatchObject({ state: 'PROCESSING', storage_path: 'path-a', nf_id: 'nf' })
  })
  it.each(['PROCESSING','COMPLETED','CLEANUP_PENDING'] as const)('a %s identity blocks another receipt', async state => {
    const id = await openNfseReview(scope, extraction(), hash)
    rows.push({ ...rows[0], id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', state })
    await expect(claimNfseReview(id, 'path', 'nf')).rejects.toThrow('CONFLICT')
  })
  it.each(['FAILED','CLEANUP_PENDING','COMPLETED'] as const)('settles %s explicitly without releasing an unconfirmed cleanup', async state => {
    const id = await openNfseReview(scope, extraction(), hash)
    await claimNfseReview(id, 'path', 'nf')
    await settleNfseReview(id, state, 'nf')
    expect(rows[0]).toMatchObject({ state, nf_id: 'nf', storage_path: 'path' } satisfies Partial<NfseReviewIntent>)
    await expect(claimNfseReview(id, 'retry-path', 'nf')).rejects.toThrow('CONFLICT')
  })
})
