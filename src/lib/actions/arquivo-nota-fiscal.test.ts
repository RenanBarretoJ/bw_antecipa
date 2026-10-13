import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nfId = '11111111-1111-4111-8111-111111111111'
const state = vi.hoisted(() => ({
  denied: false,
  calls: [] as string[],
  queries: [] as Array<{ table: string; method: string; args: unknown[] }>,
  note: { data: null as unknown, error: null as unknown },
  links: { data: [] as Array<{ documento_id: string }>, error: null as unknown },
  version: { data: null as unknown, error: null as unknown },
  original: { data: null as unknown, error: null as unknown },
  signed: { data: { signedUrl: 'https://example.invalid/original' } as { signedUrl: string } | null, error: null as unknown },
  rpc: vi.fn(async (name: string, args: unknown) => {
    state.calls.push('rpc')
    return { ...state.original, name, args }
  }),
  sign: vi.fn(async (path: string, ttl: number) => {
    state.calls.push('sign')
    return { ...state.signed, path, ttl }
  }),
  storage: vi.fn((bucket: string) => ({ bucket, createSignedUrl: state.sign })),
}))

function query(table: string) {
  const q = {
    select(...args: unknown[]) { state.queries.push({ table, method: 'select', args }); return q },
    eq(...args: unknown[]) { state.queries.push({ table, method: 'eq', args }); return q },
    in(...args: unknown[]) { state.queries.push({ table, method: 'in', args }); return q },
    order(...args: unknown[]) { state.queries.push({ table, method: 'order', args }); return q },
    limit(...args: unknown[]) { state.queries.push({ table, method: 'limit', args }); return q },
    async maybeSingle() {
      state.calls.push(`read:${table}`)
      return table === 'notas_fiscais' ? state.note : state.version
    },
    then(resolve: (value: typeof state.links) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(state.links).then(resolve, reject)
    },
  }
  return q
}

vi.mock('@/lib/auth/authorization', () => ({
  requireNotaFiscalAccess: vi.fn(async () => {
    state.calls.push('authorize')
    if (state.denied) throw new Error('SENSITIVE_INTERNAL_DETAIL')
    return { supabase: { from: query }, profile: { role: 'cedente' } }
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => {
    state.calls.push('admin')
    return { rpc: state.rpc, storage: { from: state.storage } }
  }),
}))

import { obterUrlArquivoNotaFiscal } from './arquivo-nota-fiscal'
import { requireNotaFiscalAccess } from '@/lib/auth/authorization'
import { createAdminClient } from '@/lib/supabase/server'

function note(overrides: Record<string, unknown> = {}) {
  return { id: nfId, arquivo_url: null, tipo_documento_fiscal: 'NFE', fiscal_proveniencia: null,
    fiscal_reservation_id: '22222222-2222-4222-8222-222222222222', ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.denied = false
  state.calls = []; state.queries = []
  state.note = { data: note(), error: null }
  state.links = { data: [], error: null }
  state.version = { data: null, error: null }
  state.original = { data: { bucket: 'documentos-v2', path: 'canonical/original.xml' }, error: null }
  state.signed = { data: { signedUrl: 'https://example.invalid/original' }, error: null }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

describe('original fiscal autorizado pelo journal e compatibilidade legada', () => {
  it('rejeita ID inválido antes de autenticação ou cliente privilegiado', async () => {
    expect((await obterUrlArquivoNotaFiscal('invalid')).success).toBe(false)
    expect(requireNotaFiscalAccess).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('nega acesso antes de ler metadados, resolver journal ou assinar', async () => {
    state.denied = true
    const result = await obterUrlArquivoNotaFiscal(nfId)
    expect(result).toEqual({ success: false, message: 'Arquivo indisponivel ou sem permissao de acesso.' })
    expect(JSON.stringify(result)).not.toContain('SENSITIVE_INTERNAL_DETAIL')
    expect(state.calls).toEqual(['authorize'])
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it.each([null, { id: nfId }])('não usa cliente privilegiado quando a consulta autorizada falha: %j', async data => {
    state.note = { data, error: data ? { code: 'QUERY_FAILED' } : null }
    expect((await obterUrlArquivoNotaFiscal(nfId)).success).toBe(false)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it.each(['NFE', 'NFSE'])('resolve %s canônica sem campo legado pela NF autorizada', async tipo => {
    state.note.data = note({ tipo_documento_fiscal: tipo })
    expect(await obterUrlArquivoNotaFiscal(nfId)).toEqual({ success: true, url: 'https://example.invalid/original' })
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith('fiscal_intake_get_original', { p_nf_id: nfId })
    expect(state.storage).toHaveBeenCalledWith('documentos-v2')
    expect(state.sign).toHaveBeenCalledExactlyOnceWith('canonical/original.xml', 600)
    expect(state.calls.indexOf('authorize')).toBeLessThan(state.calls.indexOf('admin'))
    expect(state.calls.indexOf('read:notas_fiscais')).toBeLessThan(state.calls.indexOf('rpc'))
    expect(state.queries.every(q => q.table === 'notas_fiscais')).toBe(true)
  })

  it('usa a referência canônica em vez de um path legado divergente', async () => {
    state.note.data = note({ arquivo_url: 'legacy/different.xml' })
    state.original.data = { bucket: 'notas-fiscais', path: 'retained/original.xml' }
    expect((await obterUrlArquivoNotaFiscal(nfId)).success).toBe(true)
    expect(state.storage).toHaveBeenCalledWith('notas-fiscais')
    expect(state.sign).toHaveBeenCalledWith('retained/original.xml', 600)
    expect(state.sign).not.toHaveBeenCalledWith('legacy/different.xml', 600)
  })

  it.each([null, [], 'path', {}, { bucket: 'public', path: 'a' },
    { bucket: 'documentos-v2', path: '' }, { bucket: 'documentos-v2', path: 1 }])(
    'falha fechado para referência canônica inválida, sem fallback legado: %j', async data => {
      state.note.data = note({ tipo_documento_fiscal: 'NFSE', arquivo_url: 'legacy.pdf', fiscal_proveniencia: { sha256: 'a'.repeat(64) } })
      state.original.data = data
      expect((await obterUrlArquivoNotaFiscal(nfId)).success).toBe(false)
      expect(state.sign).not.toHaveBeenCalled()
      expect(state.queries.every(q => q.table === 'notas_fiscais')).toBe(true)
    })

  it('não assina nem busca outro bucket quando o journal falha', async () => {
    state.original.error = { message: 'SENSITIVE_INTERNAL_DETAIL' }
    const result = await obterUrlArquivoNotaFiscal(nfId)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).not.toContain('SENSITIVE_INTERNAL_DETAIL')
    expect(state.sign).not.toHaveBeenCalled()
  })

  it.each(['NFE', 'NFSE'])('preserva %s legada no bucket histórico sem consultar journal', async tipo => {
    state.note.data = note({ fiscal_reservation_id: null, tipo_documento_fiscal: tipo, arquivo_url: 'legacy/original.pdf' })
    expect((await obterUrlArquivoNotaFiscal(nfId)).success).toBe(true)
    expect(state.rpc).not.toHaveBeenCalled()
    expect(state.storage).toHaveBeenCalledWith('notas-fiscais')
    expect(state.sign).toHaveBeenCalledWith('legacy/original.pdf', 600)
  })

  it('preserva NFSE legada vinculada por versão e hash do original', async () => {
    const digest = 'a'.repeat(64)
    state.note.data = note({ fiscal_reservation_id: null, tipo_documento_fiscal: 'NFSE', fiscal_proveniencia: { sha256: digest } })
    state.links.data = [{ documento_id: 'old-document' }]
    state.version.data = { bucket: 'documentos-v2', path: 'legacy/version.pdf' }
    expect((await obterUrlArquivoNotaFiscal(nfId)).success).toBe(true)
    expect(state.rpc).not.toHaveBeenCalled()
    expect(state.queries).toContainEqual({ table: 'documento_versoes', method: 'eq', args: ['sha256', digest] })
    expect(state.storage).toHaveBeenCalledWith('documentos-v2')
    expect(state.sign).toHaveBeenCalledWith('legacy/version.pdf', 600)
  })

  it('não assina uma NF sem referência original', async () => {
    state.note.data = note({ fiscal_reservation_id: null })
    expect((await obterUrlArquivoNotaFiscal(nfId)).success).toBe(false)
    expect(state.sign).not.toHaveBeenCalled()
  })

  it('trata objeto indisponível sem retornar URL ou erro interno', async () => {
    state.signed = { data: null, error: { name: 'OBJECT_NOT_FOUND', message: 'SENSITIVE_INTERNAL_DETAIL' } }
    const result = await obterUrlArquivoNotaFiscal(nfId)
    expect(result).toEqual({ success: false, message: 'Nao foi possivel abrir o arquivo da nota fiscal.' })
    expect(JSON.stringify(result)).not.toContain('SENSITIVE_INTERNAL_DETAIL')
  })
})
