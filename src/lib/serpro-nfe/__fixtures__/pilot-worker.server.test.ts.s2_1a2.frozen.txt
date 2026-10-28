import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
import { runSerproNfePilotOnce, type SerproNfePilotInput } from './pilot-worker.server'

const input: SerproNfePilotInput = {
  authorizationId: 'a1000000-0000-4000-8000-000000000001',
  consultaId: 'a2000000-0000-4000-8000-000000000001',
  fundoId: 'a3000000-0000-4000-8000-000000000001',
  notaFiscalId: 'a4000000-0000-4000-8000-000000000001',
  chaveAcesso: '35261014224864000100550020000021901123456788',
  nonceHash: 'a'.repeat(64),
  operadorId: 'a5000000-0000-4000-8000-000000000001',
}

const job = {
  authorization_id: input.authorizationId,
  consulta_id: input.consultaId,
  snapshot_id: 'a6000000-0000-4000-8000-000000000001',
  fundo_id: input.fundoId,
  nota_fiscal_id: input.notaFiscalId,
  lease_token: 'a7000000-0000-4000-8000-000000000001',
}

const snapshot = {
  chave_acesso: input.chaveAcesso,
  modelo: '55',
  numero_nf: '2190',
  serie: '2',
  cnpj_emitente: '14224864000100',
  cnpj_destinatario: '12345678000190',
  data_emissao: '2026-10-20',
  valor_total: 71057,
}

function enableRuntime() {
  vi.stubEnv('SERPRO_NFE_WORKER_ENABLED', 'true')
  vi.stubEnv('SERPRO_NFE_CONTRACT_VERIFIED', 'true')
  vi.stubEnv('SERPRO_NFE_QUERY_ENABLED', 'true')
  vi.stubEnv('SERPRO_NFE_CONSUMER_KEY', 'synthetic-key')
  vi.stubEnv('SERPRO_NFE_CONSUMER_SECRET', 'synthetic-secret')
}

function mockDb(options?: { jobs?: unknown[]; snapshot?: unknown }) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'nfe_fiscal_pilot_claim') {
      return { data: options?.jobs ?? [job], error: null }
    }
    return { data: true, error: null }
  })
  const maybeSingle = vi.fn(async () => ({ data: options?.snapshot ?? snapshot, error: null }))
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { db: { rpc, from }, rpc, from }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('worker seletivo do piloto SERPRO', () => {
  it('nao toca banco nem provider enquanto os gates runtime estao OFF', async () => {
    vi.stubEnv('SERPRO_NFE_WORKER_ENABLED', 'false')
    const db = { rpc: vi.fn(), from: vi.fn() }
    const query = vi.fn()

    await expect(runSerproNfePilotOnce(input, { db, query })).resolves.toEqual({
      processed: 0,
      skipped: 'CAPABILITY_UNVERIFIED',
    })
    expect(db.rpc).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('rejeita claim vazio sem consultar o provider', async () => {
    enableRuntime()
    const { db, rpc } = mockDb({ jobs: [] })
    const query = vi.fn()

    await expect(runSerproNfePilotOnce(input, { db, query })).resolves.toEqual({
      processed: 0,
      skipped: 'PILOT_CLAIM_REJECTED',
    })
    expect(query).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('falha fechado quando a identidade retornada nao coincide', async () => {
    enableRuntime()
    const { db, rpc } = mockDb({ jobs: [{ ...job, fundo_id: 'outro-fundo' }] })
    const query = vi.fn()

    await expect(runSerproNfePilotOnce(input, { db, query })).resolves.toEqual({
      processed: 1,
      status: 'INCONCLUSIVO',
    })
    expect(query).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenLastCalledWith('nfe_fiscal_pilot_fail', expect.objectContaining({
      p_error_code: 'PILOT_IDENTITY_MISMATCH',
    }))
  })

  it('falha fechado quando snapshot, modelo ou chave divergem', async () => {
    enableRuntime()
    const { db, rpc } = mockDb({ snapshot: { ...snapshot, modelo: '65' } })
    const query = vi.fn()

    await expect(runSerproNfePilotOnce(input, { db, query })).resolves.toEqual({
      processed: 1,
      status: 'INCONCLUSIVO',
    })
    expect(query).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenLastCalledWith('nfe_fiscal_pilot_fail', expect.objectContaining({
      p_error_code: 'PILOT_SNAPSHOT_IDENTITY_MISMATCH',
    }))
  })

  it('faz exatamente uma consulta mock e finaliza pela RPC piloto', async () => {
    enableRuntime()
    const { db, rpc } = mockDb()
    const query = vi.fn().mockResolvedValue({
      httpStatus: 200,
      payload: {
        NFe: {
          nfeProc: {
            protNFe: { infProt: { chNFe: input.chaveAcesso, cStat: '100', xMotivo: 'Autorizado' } },
            NFe: {
              infNFe: {
                ide: { nNF: '2190', serie: '2', dhEmi: '2026-10-20T09:00:00-03:00' },
                emit: { CNPJ: '14224864000100' },
                dest: { CNPJ: '12345678000190' },
                total: { ICMSTot: { vNF: '71057.00' } },
                cobr: { dup: [] },
              },
            },
          },
          procEventosNFe: [],
        },
      },
    })

    await expect(runSerproNfePilotOnce(input, {
      db,
      query,
      now: () => new Date('2026-10-28T14:00:00.000Z'),
    })).resolves.toMatchObject({ processed: 1 })

    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith(input.chaveAcesso, expect.objectContaining({ timeoutMs: 15_000 }))
    expect(rpc).toHaveBeenCalledWith('nfe_fiscal_pilot_claim', {
      p_authorization_id: input.authorizationId,
      p_consulta_id: input.consultaId,
      p_fundo_id: input.fundoId,
      p_nota_fiscal_id: input.notaFiscalId,
      p_chave_acesso: input.chaveAcesso,
      p_nonce_hash: input.nonceHash,
      p_operador_id: input.operadorId,
    })
    expect(rpc).toHaveBeenCalledWith('nfe_fiscal_pilot_complete', expect.objectContaining({
      p_authorization_id: input.authorizationId,
      p_consulta_id: input.consultaId,
      p_lease_token: job.lease_token,
    }))
  })

  it('uma falha mock e terminal e nao executa retry', async () => {
    enableRuntime()
    const { db, rpc } = mockDb()
    const query = vi.fn().mockRejectedValue(new Error('synthetic failure'))

    await expect(runSerproNfePilotOnce(input, { db, query })).resolves.toEqual({
      processed: 1,
      status: 'INCONCLUSIVO',
    })
    expect(query).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenLastCalledWith('nfe_fiscal_pilot_fail', expect.objectContaining({
      p_authorization_id: input.authorizationId,
      p_error_code: 'PILOT_PROVIDER_OR_MAPPING_ERROR',
    }))
  })
})
