import { beforeEach, describe, expect, it, vi } from 'vitest'
const nf = '11111111-1111-4111-8111-111111111111'
const pdf = '22222222-2222-4222-8222-222222222222'
const reservation = '33333333-3333-4333-8333-333333333333'
const state = vi.hoisted(() => ({ denied: false, aal2: true, queryFailure: '', queries: [] as Array<{ table: string; method: string; args: unknown[] }>,
  nota: {} as Record<string, unknown>, versions: [] as Record<string, unknown>[],
  journal: { bucket: 'documentos-v2', path: 'private/original.xml' } as unknown,
  original: vi.fn(async () => ({ success: true, url: 'https://example.invalid/original' })),
  version: vi.fn(async () => ({ success: true, url: 'https://example.invalid/pdf' })),
  admin: vi.fn(), auth: vi.fn(),
}))
function query(table: string) {
  const q = {
    select(...args: unknown[]) { state.queries.push({ table, method: 'select', args }); return q },
    eq(...args: unknown[]) { state.queries.push({ table, method: 'eq', args }); return q },
    in(...args: unknown[]) { state.queries.push({ table, method: 'in', args }); return q },
    order(...args: unknown[]) { state.queries.push({ table, method: 'order', args }); return q },
    async maybeSingle() { return { data: state.nota, error: state.queryFailure === table ? { code: 'PRIVATE_SQL_DETAIL' } : null } },
    then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
      const data = table === 'documento_vinculos' ? [{ documento_id: 'doc-xml' }, { documento_id: 'doc-pdf' }] : state.versions
      return Promise.resolve({ data, error: state.queryFailure === table ? { code: 'PRIVATE_SQL_DETAIL' } : null }).then(resolve, reject)
    },
  }
  return q
}
vi.mock('@/lib/auth/authorization', () => ({ requireNotaFiscalAccess: async () => {
  state.auth(); if (state.denied) throw new Error('SECRET_INTERNAL_DETAIL')
  return { supabase: { from: query }, profile: { role: 'cedente' } }
} }))
vi.mock('@/lib/auth/mfa', () => ({ validarNivelAutenticacao: async () => state.aal2 }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => { state.admin(); return { rpc: async () => ({ data: state.journal, error: null }) } } }))
vi.mock('@/lib/actions/arquivo-nota-fiscal', () => ({ obterUrlArquivoNotaFiscal: (...args: unknown[]) => state.original(...args as []) }))
vi.mock('@/lib/actions/documento-v2', () => ({ baixarVersaoDocumento: (...args: unknown[]) => state.version(...args as []) }))
import { listarArquivosOriginaisNotaFiscal, obterAcessoArquivoFiscal } from './arquivos-fiscais'

beforeEach(() => {
  vi.clearAllMocks(); state.denied = false; state.aal2 = true; state.queryFailure = ''; state.queries = []
  state.nota = { id: nf, arquivo_url: null, tipo_documento_fiscal: 'NFE', fiscal_reservation_id: reservation }
  state.journal = { bucket: 'documentos-v2', path: 'private/original.xml' }
  state.versions = [
    { id: 'xml-id', documento_id: 'doc-xml', bucket: 'documentos-v2', path: 'private/original.xml', nome_original: 'nota.xml', mime_type: 'application/xml', tamanho_bytes: 10, numero_versao: 1 },
    { id: pdf, documento_id: 'doc-pdf', bucket: 'documentos-v2', path: 'private/danfe.pdf', nome_original: 'danfe.pdf', mime_type: 'application/pdf', tamanho_bytes: 20, numero_versao: 1 },
  ]
})

describe('par fiscal com metadados mínimos e acesso por clique', () => {
  it('não consulta nem usa privilégio para ID inválido', async () => {
    expect((await listarArquivosOriginaisNotaFiscal('bad')).success).toBe(false)
    expect(state.auth).not.toHaveBeenCalled(); expect(state.admin).not.toHaveBeenCalled()
  })
  it('nega metadados e link antes de usar o journal quando não autorizado', async () => {
    state.denied = true
    const result = await obterAcessoArquivoFiscal(nf, 'original')
    expect(result.success).toBe(false); expect(JSON.stringify(result)).not.toContain('SECRET_INTERNAL_DETAIL')
    expect(state.admin).not.toHaveBeenCalled(); expect(state.original).not.toHaveBeenCalled(); expect(state.version).not.toHaveBeenCalled()
  })
  it('lista original XML e DANFE sem expor URL, bucket ou caminho', async () => {
    const result = await listarArquivosOriginaisNotaFiscal(nf)
    expect(result.success).toBe(true)
    if (!result.success) throw new Error('expected list')
    expect(result.arquivos.map(x => [x.id, x.nome, x.tipo, x.mimeType])).toEqual([['original', 'nota.xml', 'XML', 'application/xml'], [pdf, 'danfe.pdf', 'DANFE', 'application/pdf']])
    expect(JSON.stringify(result)).not.toMatch(/private|bucket|https:/)
    expect(state.original).not.toHaveBeenCalled(); expect(state.version).not.toHaveBeenCalled()
    expect(state.queries).toContainEqual({ table: 'documento_vinculos', method: 'eq', args: ['nota_fiscal_id', nf] })
    expect(state.queries).toContainEqual({ table: 'documento_versoes', method: 'eq', args: ['fiscal_reservation_id', reservation] })
  })
  it('reautoriza original e companheiro pelas actions existentes', async () => {
    expect((await obterAcessoArquivoFiscal(nf, 'original')).success).toBe(true)
    expect((await obterAcessoArquivoFiscal(nf, pdf)).success).toBe(true)
    expect(state.original).toHaveBeenCalledWith(nf); expect(state.version).toHaveBeenCalledWith(pdf); expect(state.auth).toHaveBeenCalledTimes(2)
  })
  it('não assina uma versão arbitrária fora da lista da NF', async () => {
    expect((await obterAcessoArquivoFiscal(nf, '44444444-4444-4444-8444-444444444444')).success).toBe(false)
    expect(state.version).not.toHaveBeenCalled(); expect(state.original).not.toHaveBeenCalled()
  })
  it('IDs de arquivo malformados não escolhem caminho de Storage', async () => {
    expect((await obterAcessoArquivoFiscal(nf, 'private/other.pdf')).success).toBe(false)
    expect(state.auth).not.toHaveBeenCalled()
  })
  it('não aceita JWT AAL1 mesmo quando a sessão canônica foi elevada depois da emissão', async () => {
    state.aal2 = false
    expect((await obterAcessoArquivoFiscal(nf, 'original')).success).toBe(false)
    expect(state.queries).toEqual([]); expect(state.admin).not.toHaveBeenCalled(); expect(state.original).not.toHaveBeenCalled()
  })
  it.each(['notas_fiscais', 'documento_vinculos', 'documento_versoes'])('falha fechado para erro na consulta %s', async table => {
    state.queryFailure = table
    const result = await obterAcessoArquivoFiscal(nf, pdf)
    expect(result.success).toBe(false); expect(JSON.stringify(result)).not.toContain('PRIVATE_SQL_DETAIL')
    expect(state.version).not.toHaveBeenCalled()
  })
  it('não usa path legado divergente quando o journal falha', async () => {
    state.nota.arquivo_url = 'legacy.xml'; state.journal = null
    expect((await listarArquivosOriginaisNotaFiscal(nf)).success).toBe(false)
  })
  it('não inclui formato não fiscal ou bucket inesperado como DANFE', async () => {
    state.versions.push({ id: 'foreign', bucket: 'other', path: 'a.pdf', mime_type: 'application/pdf' })
    state.versions.push({ id: 'image', bucket: 'documentos-v2', path: 'a.png', mime_type: 'image/png' })
    const result = await listarArquivosOriginaisNotaFiscal(nf)
    expect(result.success && result.arquivos.length).toBe(2)
  })
  it('preserva uma nota legada sem reserva e sem criar versão artificial', async () => {
    state.nota.fiscal_reservation_id = null; state.nota.arquivo_url = 'old/nota.xml'
    const result = await listarArquivosOriginaisNotaFiscal(nf)
    expect(result.success && result.arquivos.map(x => x.nome)).toEqual(['nota.xml']); expect(state.admin).not.toHaveBeenCalled()
  })
  it('preserva NFS-e legada sem arquivo_url usando o resolver anterior', async () => {
    state.nota.fiscal_reservation_id = null; state.nota.tipo_documento_fiscal = 'NFSE'
    expect((await obterAcessoArquivoFiscal(nf, 'original')).success).toBe(true); expect(state.original).toHaveBeenCalledWith(nf)
  })
  it('não duplica o próprio PDF original de uma NFS-e como companheiro', async () => {
    state.nota.tipo_documento_fiscal = 'NFSE'; state.journal = { bucket: 'documentos-v2', path: 'private/danfe.pdf' }
    const result = await listarArquivosOriginaisNotaFiscal(nf)
    expect(result.success && result.arquivos.map(x => x.tipo)).toEqual(['PDF'])
  })
})
