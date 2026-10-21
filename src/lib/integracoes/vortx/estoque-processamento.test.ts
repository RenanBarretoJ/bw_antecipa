import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { criptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'
import { interpretarCallbackRelatorio, prepararEventoCallback } from './relatorios-callback'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), download: vi.fn(), ingest: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('./relatorios-download.server', async original => ({ ...await original<object>(), baixarRelatorioVortx: mocks.download }))
vi.mock('./estoque-ingestao.server', () => ({ ingerirEstoqueNativoVortx: mocks.ingest }))
import { processarProximoEstoqueVortx } from './estoque-processamento.server'
import { DownloadRelatorioError } from './relatorios-download.server'
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', parcelId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/vortx-real-data-preview',
  NEXT_PUBLIC_SUPABASE_URL: 'https://phdckowbexkkvuwnzeaf.supabase.co', VORTX_REPORTS_PREVIEW_ENABLED: 'true',
  VORTX_REPORTS_PREVIEW_FUNDO_ID: id, VORTX_REPORT_STOCK_PROCESSING_ENABLED: 'true', VORTX_REPORT_DOWNLOAD_HOSTS: 'reports.example.invalid' }
function event(tipo: 'PosicaoAtivo' | 'PosicaoParcela') {
  const evento = interpretarCallbackRelatorio({ idRelatorio: id, idCarteira: 'qa-wallet', tipoRelatorio: tipo,
    dataReferencia: '2026-10-19', statusRelatorio: 'Disponível',
    urlRelatorio: `https://reports.example.invalid/${tipo}?signature=synthetic-secret`,
    dataExpiracao: new Date(Date.now() + 86400000).toISOString() })
  const { hash } = prepararEventoCallback(id, evento)
  const sealed = criptografarPortalFidcValor(JSON.stringify({ purpose: 'VORTX_CALLBACK_RELATORIO_V1',
    endpointId: id, fundoId: id, ambiente: 'producao', codigoCarteira: 'qa-wallet', hash, evento }))
  return { id: tipo === 'PosicaoAtivo' ? id : parcelId, endpoint_id: id, fundo_id: id, ambiente: 'producao',
    hash_evento: hash, payload_criptografado: sealed.ciphertext, chave_versao: sealed.chaveVersao, correlacao: 'CORRELACIONADO' }
}
function job() {
  return { id, lease: id, fundo_id: id, ambiente: 'producao', codigo_carteira: 'qa-wallet', data_referencia: '2026-10-19',
    versao_id: id, ativo_evento_id: id, parcela_evento_id: parcelId, ativo: event('PosicaoAtivo'), parcela: event('PosicaoParcela') }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('PORTAL_FIDC_CREDENTIAL_KEYS_JSON', JSON.stringify({ qa: Buffer.alloc(32, 7).toString('base64') }))
  vi.stubEnv('PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION', 'qa')
  mocks.rpc.mockImplementation(async name => ({ data: name === 'vortx_reservar_processamento_estoque' ? job() : true, error: null }))
  mocks.download.mockResolvedValue(Buffer.from('synthetic-csv'))
  mocks.ingest.mockResolvedValue({ reconciliado: true, duplicada: false, resumo: { ativos: 1, parcelas: 2 }, divergencias: [] })
})
afterEach(() => vi.unstubAllEnvs())
describe('durable stock callback processor', () => {
  it.each([{ VERCEL_ENV: 'production' }, { VERCEL_GIT_COMMIT_REF: 'main' },
    { VORTX_REPORT_STOCK_PROCESSING_ENABLED: 'false' }, { VORTX_REPORT_DOWNLOAD_HOSTS: '' }])('is inert outside approved Preview %j', async change => {
    expect(await processarProximoEstoqueVortx({ ...env, ...change })).toEqual({ estado: 'DESABILITADO' })
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled()
  })
  it('waits without network effects for a canonical pair', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    expect(await processarProximoEstoqueVortx(env)).toEqual({ estado: 'AGUARDANDO_PAR' })
    expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.ingest).not.toHaveBeenCalled()
  })
  it('decrypts in runtime, downloads only both validated events and persists without publication', async () => {
    expect(await processarProximoEstoqueVortx(env)).toEqual({ estado: 'PERSISTIDO', ativos: 1, parcelas: 2,
      duplicada: false, divergencias: 0, pddPendente: false, publicado: false })
    expect(mocks.download).toHaveBeenCalledTimes(2)
    expect(mocks.rpc).toHaveBeenCalledWith('vortx_marcar_download_estoque',{p_id:id,p_lease:id})
    expect(mocks.ingest.mock.calls[0][0]).toMatchObject({ fundoId: id, dataReferencia: '2026-10-19',
      execucao: { id, lease: id, ambiente: 'producao', versaoId: id, codigoCarteira: 'qa-wallet' } })
  })
  it.each(['correlation', 'wallet', 'pointDate', 'fund', 'ciphertext', 'eventId'])('rejects mismatched %s before download', async mode => {
    const value = job()
    if (mode === 'correlation') value.parcela.correlacao = 'PENDENTE'
    if (mode === 'wallet') value.codigo_carteira = 'different'
    if (mode === 'pointDate') value.data_referencia = '2026-10-18'
    if (mode === 'fund') value.parcela.fundo_id = parcelId
    if (mode === 'ciphertext') value.parcela.payload_criptografado = 'v1:corrupted'
    if (mode === 'eventId') value.parcela_evento_id = id
    mocks.rpc.mockImplementation(async name => ({ data: name === 'vortx_reservar_processamento_estoque' ? value : true, error: null }))
    expect(await processarProximoEstoqueVortx(env)).toEqual({ estado: 'FALHA', motivo: 'CONTRATO_INVALIDO' })
    expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.ingest).not.toHaveBeenCalled()
  })
  it('preserves financial discrepancies for review rather than publishing them', async () => {
    mocks.ingest.mockResolvedValue({ reconciliado: false, duplicada: false, resumo: { ativos: 1, parcelas: 2 }, divergencias: [{}] })
    expect(await processarProximoEstoqueVortx(env)).toMatchObject({ estado: 'REVISAO', publicado: false, divergencias: 1 })
  })
  it('persists a canonical PDD-only advisory without declaring full reconciliation or publication', async () => {
    mocks.ingest.mockResolvedValue({ reconciliado: false, reconciliadoFinanceiro: true, pddPendente: true,
      duplicada: false, resumo: { ativos: 1, parcelas: 2 }, divergencias: [{ campo: 'valor_pdd' }] })
    expect(await processarProximoEstoqueVortx(env)).toMatchObject({ estado: 'PERSISTIDO', pddPendente: true, divergencias: 1, publicado: false })
  })
  it('remains strict against an old SQL completion missing the advisory decision', async () => {
    mocks.ingest.mockResolvedValue({ reconciliado: false, duplicada: true,
      resumo: { ativos: 1, parcelas: 2 }, divergencias: [{ campo: 'valor_pdd' }] })
    expect(await processarProximoEstoqueVortx(env)).toMatchObject({ estado: 'REVISAO', pddPendente: false, publicado: false })
  })
  it('fails a denied download without ingesting or exposing its signed URL', async () => {
    mocks.download.mockRejectedValue(new DownloadRelatorioError('HOST_NEGADO'))
    expect(await processarProximoEstoqueVortx(env)).toEqual({ estado: 'FALHA', motivo: 'DOWNLOAD_FALHOU' })
    expect(mocks.ingest).not.toHaveBeenCalled()
  })
  it('checkpoint indisponível impede persistência sem afirmar download confirmado',async()=>{
    mocks.rpc.mockImplementation(async name=>name==='vortx_marcar_download_estoque'?{data:null,error:{code:'42501'}}:{data:name==='vortx_reservar_processamento_estoque'?job():true,error:null})
    expect(await processarProximoEstoqueVortx(env)).toEqual({estado:'FALHA',motivo:'PERSISTENCIA_INDETERMINADA'})
    expect(mocks.ingest).not.toHaveBeenCalled()
  })
  it('does not claim a known failure when a late worker could not update the ledger', async () => {
    mocks.download.mockRejectedValue(new DownloadRelatorioError('DOWNLOAD_TIMEOUT'))
    mocks.rpc.mockImplementation(async name => ({ data: name === 'vortx_reservar_processamento_estoque' ? job() : false, error: null }))
    await expect(processarProximoEstoqueVortx(env)).rejects.toThrow('RESULTADO_PROCESSAMENTO_INDETERMINADO')
  })
})
