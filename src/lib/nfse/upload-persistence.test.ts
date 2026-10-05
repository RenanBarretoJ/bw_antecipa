import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractDanfseV2 } from './danfse-v2'
import { danfseFixture } from './fixtures/danfse-v2'
import { municipalFixture } from './fixtures/municipal'
import { validateMunicipalVisual } from './municipal-visual-contract'
import { uploadNFs } from '@/lib/actions/nota-fiscal'
const m = vi.hoisted(() => ({
  insertError: false, cleanupError: false, duplicate: false,
  inserts: [] as Record<string, unknown>[], states: [] as string[],
  upload: vi.fn(), remove: vi.fn(), probe: vi.fn(), read: vi.fn(), claim: vi.fn(),
  auth: vi.fn(), scope: vi.fn(), document: vi.fn(), event: vi.fn(),
}))
vi.mock('@/lib/auth/authorization', () => ({ AuthorizationError: class extends Error {}, requireAuthenticated: (...args: unknown[]) => m.auth(...args), requireGestor: vi.fn() }))
vi.mock('@/lib/notas-fiscais/contexto-operacional.server', () => ({ resolverContextoOperacionalNotaFiscal: (...args: unknown[]) => m.scope(...args), validarNotaNoContextoSelecionado: vi.fn() }))
vi.mock('@/lib/nfse/pdf-dispatcher.server', () => ({ probeNfsePdf: (...args: unknown[]) => m.probe(...args) }))
vi.mock('@/lib/nfse/review-intents.server', () => ({
  openNfseReview: async () => 'receipt', readNfseReview: (...args: unknown[]) => m.read(...args),
  claimNfseReview: (...args: unknown[]) => m.claim(...args), trackNfseDocumentPath: vi.fn(),
  settleNfseReview: async (_id: string, state: string) => { m.states.push(state) },
}))
vi.mock('@/lib/cedentes/estabelecimentos.server', () => ({
  resolverEstabelecimentoOrigem: async () => ({ id: 'establishment' }), EstabelecimentoOrigemError: class extends Error {},
}))
vi.mock('@/lib/documentos-v2/upload', () => ({ uploadDocumentoSeRequerido: (...args: unknown[]) => m.document(...args) }))
vi.mock('@/lib/eventos-dominio/registrar', () => ({ carregarContextoEventoNota: async () => ({}), registrarEventoDominio: (...args: unknown[]) => m.event(...args) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/notas-fiscais/upload-observability', () => ({ logUploadStage: vi.fn(), createUploadTelemetry: () => ({ correlationId:'qa', start:vi.fn(), parsed:vi.fn(), compensated:vi.fn(), complete:vi.fn() }) }))
vi.mock('@/lib/supabase/server', () => {
  const client = {
    storage: { from: () => ({ upload: (...args: unknown[]) => m.upload(...args), remove: (...args: unknown[]) => m.remove(...args) }) },
    from: (table: string) => {
      let inserted: Record<string, unknown> | undefined
      let deleted = false
      const result = () => {
        if (inserted) return m.insertError ? { data:null,error:{code:'23514'} } : { data:{id:inserted.id},error:null }
        if (table==='notas_fiscais' && !deleted) return {data:m.duplicate?{id:'existing'}:null,error:null}
        return {data:[],error:null}
      }
      const q = {
        insert: (row: Record<string,unknown>) => { inserted=row;m.inserts.push(row);return q },
        select: () => q, eq: () => q, in: () => q, limit: () => q,
        delete: () => { deleted=true;return q },
        single: async () => result(), maybeSingle: async () => result(),
        then: (resolve: (value: unknown)=>unknown) => Promise.resolve(result()).then(resolve),
      }
      return q
    },
  }
  return { createClient: async () => client, createAdminClient: () => client }
})
beforeEach(() => {
  vi.clearAllMocks();m.insertError=false;m.cleanupError=false;m.duplicate=false;m.inserts=[];m.states=[]
  vi.stubEnv('NFSE_UPLOAD_ENABLED','true')
  m.auth.mockResolvedValue({ user:{id:'actor'},profile:{role:'cedente'} })
  m.scope.mockResolvedValue({ actorUserId:'actor',actorRole:'cedente',cedente:{id:'cedente',cnpj:'11222333000181'},cedenteFundoId:'link',fundoId:'fund' })
  m.probe.mockResolvedValue(extractDanfseV2(danfseFixture()))
  m.read.mockResolvedValue({});m.claim.mockResolvedValue(undefined)
  m.upload.mockResolvedValue({error:null});m.remove.mockImplementation(async () => ({error:m.cleanupError?{name:'StorageFailure'}:null}))
  m.document.mockResolvedValue(false);m.event.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())
function request(review=true){
  const data=new FormData();data.append('arquivos',new File(['original-pdf'],'test.pdf',{type:'application/pdf'}))
  data.append('nfse_vencimento_manual','2099-11-09')
  if(review)data.append('nfse_review_intent','receipt')
  data.append('valor_bruto','1');data.append('valor_liquido','1');data.append('numero_nf','CLIENT_FORGED')
  return data
}
describe('real upload action NFS-e storage saga', () => {
  it('municipal review has no NF or Storage write and later persists the same verified facts', async () => {
    m.probe.mockResolvedValue(validateMunicipalVisual(municipalFixture()))
    expect((await uploadNFs(request(false)))?.uploadBatch?.results[0]?.status).toBe('REQUIRES_REVIEW')
    expect(m.upload).not.toHaveBeenCalled();expect(m.inserts).toHaveLength(0)
    expect((await uploadNFs(request()))?.success).toBe(true)
    expect(m.inserts[0]).toMatchObject({numero_nf:'1234',chave_acesso:null,valor_liquido:null,
      fiscal_proveniencia:{orgao_emissor:'PREFEITURA MUNICIPAL DE CIDADE QA',codigo_verificacao:'QA.1234.5678-X'}})
  })
  it('municipal duplicate is rejected before any Storage or reservation', async () => {
    m.probe.mockResolvedValue(validateMunicipalVisual(municipalFixture()));m.duplicate=true
    expect((await uploadNFs(request()))?.uploadBatch?.results[0]?.status).toBe('DUPLICATE')
    expect(m.upload).not.toHaveBeenCalled();expect(m.claim).not.toHaveBeenCalled()
  })
  it('reextracts, ignores client fiscal fields, and keeps authenticated persistence', async () => {
    expect((await uploadNFs(request()))?.success).toBe(true)
    expect(m.probe).toHaveBeenCalledOnce()
    expect(m.inserts[0]).toMatchObject({numero_nf:'49',valor_bruto:39521.98,valor_liquido:37229.70,vencimento_origem:'MANUAL'})
    expect(m.auth).toHaveBeenCalledTimes(3)
    expect(m.states).toEqual(['PROCESSING','COMPLETED'])
  })
  it('cannot bypass first review with a date', async () => {
    expect((await uploadNFs(request(false)))?.uploadBatch?.results[0]?.status).toBe('REQUIRES_REVIEW')
    expect(m.upload).not.toHaveBeenCalled();expect(m.inserts).toHaveLength(0)
  })
  it('checks duplicate before Storage', async () => {
    m.duplicate=true
    expect((await uploadNFs(request()))?.uploadBatch?.results[0]?.status).toBe('DUPLICATE')
    expect(m.upload).not.toHaveBeenCalled();expect(m.claim).not.toHaveBeenCalled()
  })
  it('fails closed on review drift before Storage', async () => {
    m.read.mockRejectedValue(new Error('NFSE_REVIEW_DRIFT'))
    expect((await uploadNFs(request()))?.uploadBatch?.results[0]?.status).toBe('REJECTED_INVALID')
    expect(m.upload).not.toHaveBeenCalled()
  })
  it('denies a context revoked during parsing', async () => {
    m.scope.mockResolvedValueOnce({ actorUserId:'actor',actorRole:'cedente',cedente:{id:'cedente',cnpj:'11222333000181'},cedenteFundoId:'link',fundoId:'fund' }).mockRejectedValueOnce(new Error('revoked'))
    expect((await uploadNFs(request()))?.uploadBatch?.results[0]?.status).toBe('REJECTED_INVALID')
    expect(m.upload).not.toHaveBeenCalled()
  })
  it('compensates an insert failure and releases only after cleanup', async () => {
    m.insertError=true
    expect((await uploadNFs(request()))?.uploadBatch?.results[0]?.status).toBe('PERSISTENCE_ERROR')
    expect(m.remove).toHaveBeenCalledOnce();expect(m.states).toEqual(['FAILED'])
  })
  it('retains explicit CLEANUP_PENDING on failed compensation', async () => {
    m.insertError=true;m.cleanupError=true
    expect((await uploadNFs(request()))?.uploadBatch?.results[0]?.status).toBe('STORAGE_ERROR')
    expect(m.states).toEqual(['CLEANUP_PENDING']);expect(m.states).not.toContain('FAILED')
  })
  it('compensates even an uncertain upload response', async () => {
    m.upload.mockResolvedValue({error:{name:'Timeout'}})
    expect((await uploadNFs(request()))?.uploadBatch?.results[0]?.status).toBe('PERSISTENCE_ERROR')
    expect(m.remove).toHaveBeenCalledOnce();expect(m.states).toEqual(['FAILED'])
  })
})
