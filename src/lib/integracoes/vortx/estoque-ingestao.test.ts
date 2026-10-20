import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), rpc: vi.fn(), confirmed: vi.fn(), resolver: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({
  storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) }, rpc: mocks.rpc,
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.confirmed }) }) }) }),
}) }))
vi.mock('../resolver.server', () => ({ integrationRuntimeEnvironment: () => 'homologacao', resolverIntegracaoPorCapability: mocks.resolver }))
import { ingerirEstoqueNativoVortx } from './estoque-ingestao.server'
import { CONTEXTO_CSV_QA, csvVortxQa } from './__fixtures__/relatorios-csv'

const input = () => ({ fundoId: CONTEXTO_CSV_QA.fundoId, dataReferencia: CONTEXTO_CSV_QA.dataReferencia,
  ativo: { nome: 'ativo.csv', conteudo: csvVortxQa('PosicaoAtivo') },
  parcela: { nome: 'parcela.csv', conteudo: csvVortxQa('PosicaoParcela') } })

describe('worker interno de estoque Vortx e compensacao privada', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.resolver.mockResolvedValue({ status: 'CONFIGURADA', integrationVersion: {
      providerKey: 'VORTX', adapterKey: 'vortx_vrs', integrationVersionId: '893aa90d-459f-40bf-bc96-71fa550e03ad', config: { codigo_carteira: CONTEXTO_CSV_QA.codigoCarteira },
    } })
    mocks.upload.mockResolvedValue({ error: null }); mocks.remove.mockResolvedValue({ error: null })
    mocks.confirmed.mockResolvedValue({ data: null, error: null })
    mocks.rpc.mockImplementation(async (name: string, args: { p_payload?: { id: string }; p_linhas?: object[] }) => ({
      data: name === 'vortx_reservar_manifesto_estoque' ? true : name === 'vortx_estagiar_linhas_estoque' ? args.p_linhas!.length
        : { id: args.p_payload!.id, status: 'VALIDA', duplicada: false, reconciliado: true }, error: null,
    }))
  })
  it('preserva os dois originais privados antes da transacao, sem publicar automaticamente', async () => {
    const result = await ingerirEstoqueNativoVortx(input())
    expect(result.status).toBe('VALIDA')
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.upload.mock.calls.every(call => call[2].upsert === false)).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.rpc.mock.calls[0][0]).toBe('persistir_estoque_vortx')
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('recusa fonte indisponivel antes de upload e RPC de escrita', async () => {
    mocks.resolver.mockResolvedValue({ status: 'INDISPONIVEL' })
    await expect(ingerirEstoqueNativoVortx(input())).rejects.toThrow('indisponivel')
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('compensa somente o primeiro arquivo se o segundo upload falhar', async () => {
    mocks.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'synthetic failure' } })
    await expect(ingerirEstoqueNativoVortx(input())).rejects.toThrow('arquivos privados')
    expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]])
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('compensa arquivos apos erro com ausencia confirmada da transacao', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23514' } })
    await expect(ingerirEstoqueNativoVortx(input())).rejects.toThrow('confirmar')
    expect(mocks.remove).toHaveBeenCalledWith(mocks.upload.mock.calls.map(call => call[0]))
  })
  it.each(['lookup_failed', 'possibly_committed'])('preserva originais se resultado for %s', async mode => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'transport result unknown' } })
    mocks.confirmed.mockResolvedValue(mode === 'lookup_failed' ? { data: null, error: { message: 'unavailable' } } : { data: { id: 'committed-qa' }, error: null })
    await expect(ingerirEstoqueNativoVortx(input())).rejects.toThrow()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('retry duplicado remove somente os novos uploads, preservando o snapshot vencedor', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: '61f02178-58af-4bfa-9a33-f97ac5b3dd96', status: 'VALIDA', duplicada: true }, error: null })
    expect((await ingerirEstoqueNativoVortx(input())).duplicada).toBe(true)
    expect(mocks.remove).toHaveBeenCalledWith(mocks.upload.mock.calls.map(call => call[0]))
  })
  it('nao afirma compensacao quando Storage rejeita a remocao', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23514' } }); mocks.remove.mockResolvedValue({ error: { message: 'cleanup unavailable' } })
    await expect(ingerirEstoqueNativoVortx(input())).rejects.toThrow('compensacao')
  })
  it('uses the database-issued environment/version/wallet, not a global runtime override', async () => {
    const execucao = { id: CONTEXTO_CSV_QA.fundoId, lease: CONTEXTO_CSV_QA.fundoId,
      ambiente: 'producao' as const, versaoId: '893aa90d-459f-40bf-bc96-71fa550e03ad', codigoCarteira: CONTEXTO_CSV_QA.codigoCarteira }
    await ingerirEstoqueNativoVortx({ ...input(), execucao })
    expect(mocks.resolver.mock.calls[0][0]).toMatchObject({ ambiente: 'producao', capability: 'ESTOQUE' })
    const completion = mocks.rpc.mock.calls.find(call => call[0] === 'vortx_concluir_processamento_estoque')
    expect(completion?.[1]).toMatchObject({ p_id: execucao.id, p_lease: execucao.lease,
      p_payload: { ambiente: 'producao', integracao_fundo_versao_id: execucao.versaoId } })
    expect(completion?.[1].p_payload.ativos).toBeUndefined(); expect(completion?.[1].p_payload.parcelas).toBeUndefined()
    expect(mocks.rpc.mock.calls.filter(call => call[0] === 'vortx_estagiar_linhas_estoque')).toHaveLength(2)
    expect(mocks.rpc.mock.calls[0][0]).toBe('vortx_reservar_manifesto_estoque')
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0])
  })
  it('does not upload anything if the private file intent is denied', async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    await expect(ingerirEstoqueNativoVortx({ ...input(), execucao: { id: CONTEXTO_CSV_QA.fundoId, lease: CONTEXTO_CSV_QA.fundoId,
      ambiente: 'homologacao', versaoId: '893aa90d-459f-40bf-bc96-71fa550e03ad', codigoCarteira: CONTEXTO_CSV_QA.codigoCarteira } })).rejects.toThrow('reservar')
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('refuses a changed integration version before uploading', async () => {
    await expect(ingerirEstoqueNativoVortx({ ...input(), execucao: { id: CONTEXTO_CSV_QA.fundoId, lease: CONTEXTO_CSV_QA.fundoId,
      ambiente: 'producao', versaoId: CONTEXTO_CSV_QA.fundoId, codigoCarteira: CONTEXTO_CSV_QA.codigoCarteira } })).rejects.toThrow('indisponivel')
    expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('compensates only owned files when chunk staging fails before financial completion', async () => {
    mocks.rpc.mockImplementation(async name => name === 'vortx_reservar_manifesto_estoque'
      ? { data: true, error: null } : { data: null, error: { code: 'synthetic-failure' } })
    await expect(ingerirEstoqueNativoVortx({ ...input(), execucao: { id: CONTEXTO_CSV_QA.fundoId, lease: CONTEXTO_CSV_QA.fundoId,
      ambiente: 'homologacao', versaoId: '893aa90d-459f-40bf-bc96-71fa550e03ad', codigoCarteira: CONTEXTO_CSV_QA.codigoCarteira } })).rejects.toThrow('bloco')
    expect(mocks.rpc.mock.calls.every(call => ['vortx_reservar_manifesto_estoque', 'vortx_estagiar_linhas_estoque'].includes(call[0]))).toBe(true)
    expect(mocks.remove).toHaveBeenCalledWith(mocks.upload.mock.calls.map(call => call[0]))
  })
})
