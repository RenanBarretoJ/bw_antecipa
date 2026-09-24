import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({ requireAccess: vi.fn(), admin: vi.fn(), notify: vi.fn() }))
vi.mock('@/lib/auth/authorization', () => ({ requireCedenteManagementAccess: mocks.requireAccess }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('./notificacao', () => ({ notificarGestores: mocks.notify }))

import { prepararUploadDocumentoCadastral, finalizarUploadDocumentoCadastral, reconciliarUploadDocumentoCadastral } from './cedente-documento-upload'

const id = '89241dcb-56e4-4191-9d33-87f9d8de465e'
const owner = 'user-a'
const cedenteId = 'cedente-a'
const metadata = { tipo: 'contrato_social', nomeArquivo: 'contrato.pdf', mime: 'application/pdf', tamanho: 5_115_049 }

function fixture() {
  const state = {
    intent: null as Record<string, unknown> | null,
    object: { size: metadata.tamanho, contentType: metadata.mime } as { size: number; contentType: string } | null,
    latest: [] as { status: string; atualizacao_solicitada_em: string | null }[],
  }
  const path = `00123456000190/contrato_social/${id}_contrato.pdf`
  state.intent = {
    id, usuario_id: owner, cedente_id: cedenteId, tipo_documento: metadata.tipo,
    representante_id: null, storage_bucket: 'documentos-cedentes', storage_path: path,
    nome_original: metadata.nomeArquivo, mime_type: metadata.mime, tamanho_esperado: metadata.tamanho,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), status: 'UPLOADED',
  }
  const bucket = {
    createSignedUploadUrl: vi.fn().mockResolvedValue({ data: { token: 'storage-token' }, error: null }),
    info: vi.fn(async () => ({ data: state.object, error: state.object ? null : { message: 'not found' } })),
    remove: vi.fn(),
  }
  const rpc = vi.fn().mockResolvedValue({ data: [{ documento_id: 'doc-2', versao: 2, status: 'enviado', storage_path: path, novo_registro: true }], error: null })
  const from = vi.fn((table: string) => {
    const query = {
      select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: table === 'documento_upload_intents' ? state.intent : null, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: state.latest, error: null }),
    }
    return query
  })
  const insert = vi.fn().mockResolvedValue({ error: null })
  const updateQuery = { eq: vi.fn(), in: vi.fn().mockResolvedValue({ error: null }) }
  updateQuery.eq.mockReturnValue(updateQuery)
  const adminFrom = vi.fn(() => ({ insert, update: () => updateQuery }))
  mocks.admin.mockReturnValue({ from: adminFrom })
  mocks.requireAccess.mockResolvedValue({
    supabase: { from, rpc, storage: { from: vi.fn(() => bucket) } },
    user: { id: owner }, cedente: { id: cedenteId, cnpj: '00123456000190', status: 'pendente' },
  })
  return { state, path, bucket, rpc, from, insert, adminFrom, updateQuery }
}

describe('P9.3 durable upload intents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persiste PREPARED antes de emitir URL assinada e nunca transmite binario a action', async () => {
    const mock = fixture()
    expect(await prepararUploadDocumentoCadastral(metadata)).toMatchObject({ success: true, uploadToken: 'storage-token' })
    expect(mock.insert).toHaveBeenCalledWith(expect.objectContaining({ tipo_documento: 'contrato_social', cleanup_after: expect.any(String) }))
    expect(mock.insert.mock.invocationCallOrder[0]).toBeLessThan(mock.bucket.createSignedUploadUrl.mock.invocationCallOrder[0])
    const source = readFileSync(join(process.cwd(), 'src/lib/actions/cedente-documento-upload.ts'), 'utf8')
    expect(source).not.toMatch(/\bFormData\b|\bFile\b/)
  })

  it('bloqueia arquivo acima de 20 MiB antes de persistencia e Storage', async () => {
    const mock = fixture()
    expect((await prepararUploadDocumentoCadastral({ ...metadata, tamanho: 20 * 1024 * 1024 + 1 })).success).toBe(false)
    expect(mock.insert).not.toHaveBeenCalled()
    expect(mock.bucket.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('finaliza pelo ID e nao aceita path vindo do browser', async () => {
    const mock = fixture()
    expect((await finalizarUploadDocumentoCadastral(id)).success).toBe(true)
    expect(mock.rpc).toHaveBeenCalledWith('finalizar_documento_upload_intent', { p_intent_id: id })
    expect(mock.bucket.remove).not.toHaveBeenCalled()
  })

  it('repeticao finalizada nao duplica versao nem notificacao', async () => {
    const mock = fixture()
    if (mock.state.intent) mock.state.intent.status = 'FINALIZED'
    expect((await finalizarUploadDocumentoCadastral(id)).success).toBe(true)
    expect(mock.rpc).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('falha real de FINALIZE marca FAILED sem remover objeto e permite reconciliar', async () => {
    const mock = fixture()
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001' } })
    expect((await finalizarUploadDocumentoCadastral(id)).success).toBe(false)
    expect(mock.updateQuery.in).toHaveBeenCalledWith('status', ['PREPARED', 'UPLOADED', 'FAILED'])
    expect(mock.bucket.remove).not.toHaveBeenCalled()
    expect(await reconciliarUploadDocumentoCadastral(id)).toBe('UPLOADED_NOT_FINALIZED')
  })

  it('usuario de outro cedente nao consulta Storage nem finaliza', async () => {
    const mock = fixture()
    if (mock.state.intent) mock.state.intent = null
    expect((await finalizarUploadDocumentoCadastral(id)).success).toBe(false)
    expect(await reconciliarUploadDocumentoCadastral(id)).toBe('INVALID')
    expect(mock.bucket.info).not.toHaveBeenCalled()
  })

  it('fechamento da aba deixa estado recuperavel sem callback do browser', async () => {
    const mock = fixture()
    expect(await reconciliarUploadDocumentoCadastral(id)).toBe('UPLOADED_NOT_FINALIZED')
    expect(mock.bucket.remove).not.toHaveBeenCalled()
  })

  it('resposta tardia finalizada prevalece sobre expiracao', async () => {
    const mock = fixture()
    if (mock.state.intent) {
      mock.state.intent.status = 'FINALIZED'
      mock.state.intent.expires_at = new Date(Date.now() - 60_000).toISOString()
    }
    expect(await reconciliarUploadDocumentoCadastral(id)).toBe('FINALIZED')
  })
})
