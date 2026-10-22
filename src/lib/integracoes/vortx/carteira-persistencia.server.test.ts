import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
const mocks = vi.hoisted(() => ({ admin: vi.fn(), resolve: vi.fn(), credentials: vi.fn(), original: vi.fn(), audit: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/auth/mfa', () => ({ registrarEventoSeguranca: mocks.audit }))
vi.mock('@/lib/operacoes/data-operacional.server', () => ({ obterDataCivilOperacional: () => '2026-10-22' }))
vi.mock('../resolver.server', () => ({ integrationRuntimeEnvironment: () => 'producao', resolverIntegracaoPorCapability: mocks.resolve }))
vi.mock('./credenciais.server', () => ({ resolverConfiguracaoVortxVrs: mocks.credentials }))
vi.mock('./carteira-http.server', () => ({ consultarOriginalCarteiraVortx: mocks.original }))
import { consultarEPersistirCarteiraVortx } from './carteira-persistencia.server'

const fund = '22000000-0000-4000-8000-000000000003', versionId = '27000000-0000-4000-8000-000000000004'
const jobId = '28000000-0000-4000-8000-000000000005', lease = '29000000-0000-4000-8000-000000000006'
const oldId = '28000000-0000-4000-8000-000000000007'
const input = { fundoId: fund, dataReferencia: '2026-10-20' }
const roster = { versao: 1, cotas: ['SR', 'MZ', 'SUB'].map(codigoCarteira => ({ codigoCarteira, rotulo: codigoCarteira })) }
const version = { fundoId: fund, environment: 'producao', adapterKey: 'vortx_vrs', providerKey: 'VORTX', capability: 'CARTEIRA', integrationVersionId: versionId,
  config: { codigo_carteira: 'VRS-QA', carteira_consolidada: roster } }
const headers = ['SR', 'MZ', 'SUB'].map((carteira, index) => ({ carteira, status: 'Ativa', cnpjFundo: '98000000000196', dataAtual: '2026-10-20T03:00:00.000Z', pl: [12021826.39, 13532225.29, 4438232.36][index] }))
const response = [{ carteiras: headers, ativos: [{ plTotal: 999 }], passivos: [] }]
const arquivo = Buffer.from(JSON.stringify(response))
const job = { id: jobId, lease, fundo_id: fund, versao_id: versionId, ambiente: 'producao', cnpj_fundo: '98000000000196', codigo_carteira: 'VRS-QA',
  data_referencia: input.dataReferencia, cotas_esperadas: roster, hash_arquivo: createHash('sha256').update(arquivo).digest('hex'), tamanho_bytes: arquivo.byteLength,
  storage_bucket: 'vortx-carteiras', storage_path: `${fund}/carteira/${jobId}/carteira.json` }
const receipt = { id: jobId, estado: 'PERSISTIDA', duplicada: false }
const rpc = vi.fn(), upload = vi.fn(), remove = vi.fn(), storageFrom = vi.fn(), maybeSingle = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  mocks.admin.mockReturnValue({ rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }), storage: { from: storageFrom } })
  maybeSingle.mockResolvedValue({ data: { id: fund, cnpj: '98000000000196', ativo: true }, error: null })
  storageFrom.mockReturnValue({ upload, remove }); upload.mockResolvedValue({ error: null }); remove.mockResolvedValue({ error: null })
  mocks.resolve.mockResolvedValue({ status: 'CONFIGURADA', integrationVersion: version })
  mocks.credentials.mockResolvedValue({ fundoId: fund, ambiente: 'producao' })
  mocks.original.mockResolvedValue({ arquivo, resposta: response })
  rpc.mockImplementation(async (name: string) => ({ data: name === 'vortx_reservar_carteira' ? job : name === 'vortx_concluir_carteira' ? receipt : { estado: 'PERSISTIDA', id: jobId, podeRemoverArquivo: false }, error: null }))
})
describe('persistencia interna da carteira', () => {
  it('exige autorizacao humana antes de ler credenciais ou consultar a API', async () => {
    const authorize = vi.fn().mockRejectedValue(new Error('revoked'))
    await expect(consultarEPersistirCarteiraVortx(input, authorize)).rejects.toThrow('revoked')
    expect(mocks.credentials).not.toHaveBeenCalled(); expect(mocks.original).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled()
  })
  it('revogacao apos upload bloqueia publicacao e compensa somente arquivo proprio apos fencing', async () => {
    const authorize = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('revoked'))
    rpc.mockImplementation(async (name: string) => ({ data: name === 'vortx_reservar_carteira' ? job : { estado: 'FALHA', id: null, podeRemoverArquivo: true }, error: null }))
    await expect(consultarEPersistirCarteiraVortx(input, authorize)).rejects.toThrow('CARTEIRA_NAO_PERSISTIDA_EXECUCAO_ENCERRADA')
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls.some(([name]) => name === 'vortx_concluir_carteira')).toBe(false)
    expect(remove).toHaveBeenCalledExactlyOnceWith([job.storage_path])
  })
  it('preserva original privado e conclui uma vez com PL somente dos cabecalhos', async () => {
    expect(await consultarEPersistirCarteiraVortx(input)).toEqual({ ...receipt, patrimonioLiquidoTotal: '29992284.0400' })
    expect(upload).toHaveBeenCalledExactlyOnceWith(job.storage_path, arquivo, { contentType: 'application/json', upsert: false })
    expect(rpc).toHaveBeenCalledWith('vortx_concluir_carteira', { p_id: jobId, p_lease: lease, p_resposta: response })
    expect(remove).not.toHaveBeenCalled()
  })
  it('sem cota subordinada aguarda sem reserva, upload ou PL parcial', async () => {
    mocks.original.mockResolvedValue({ arquivo, resposta: [{ carteiras: headers.slice(0, 2) }] })
    const result = await consultarEPersistirCarteiraVortx(input)
    expect(result.estado).toBe('AGUARDANDO_COTAS')
    expect(result).not.toHaveProperty('patrimonioLiquidoTotal')
    expect(rpc).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled()
  })
  it.each([
    [headers[0], headers[0], headers[2]], headers.map(h => ({ ...h, cnpjFundo: '98000000000277' })),
    headers.map(h => ({ ...h, dataAtual: '2026-10-19' })), headers.map(h => ({ ...h, pl: -1 })),
  ])('rejeita resposta fora do contrato sem escrita', async carteiras => {
    mocks.original.mockResolvedValue({ arquivo, resposta: [{ carteiras }] })
    expect((await consultarEPersistirCarteiraVortx(input)).estado).toBe('REVISAO_NECESSARIA')
    expect(rpc).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled()
  })
  it('sem configuracao nao consulta o provider nem grava', async () => {
    mocks.resolve.mockResolvedValue({ status: 'CONFIGURADA', integrationVersion: { ...version, config: {} } })
    expect((await consultarEPersistirCarteiraVortx(input)).estado).toBe('CONFIGURACAO_PENDENTE')
    expect(mocks.original).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled()
  })
  it('recusa data futura antes de consultar', async () => {
    await expect(consultarEPersistirCarteiraVortx({ ...input, dataReferencia: '2026-10-23' })).rejects.toThrow('CARTEIRA_DATA_FUTURA')
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
  it('recusa credencial de outro Fundo antes da chamada', async () => {
    mocks.credentials.mockResolvedValue({ fundoId: oldId, ambiente: 'producao' })
    await expect(consultarEPersistirCarteiraVortx(input)).rejects.toThrow('CARTEIRA_CREDENCIAL_FORA_DO_ESCOPO')
    expect(mocks.original).not.toHaveBeenCalled()
  })
  it('nao faz upload com manifesto de outro Fundo', async () => {
    rpc.mockResolvedValue({ data: { ...job, fundo_id: oldId }, error: null })
    await expect(consultarEPersistirCarteiraVortx(input)).rejects.toThrow('CARTEIRA_MANIFESTO_FORA_DO_ESCOPO')
    expect(upload).not.toHaveBeenCalled()
  })
  it('resposta de commit perdida exige confirmacao no banco e nunca apaga original publicado', async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === 'vortx_concluir_carteira') throw new Error('transport')
      return { data: name === 'vortx_reservar_carteira' ? job : { estado: 'PERSISTIDA', id: jobId, podeRemoverArquivo: false }, error: null }
    })
    expect((await consultarEPersistirCarteiraVortx(input)).estado).toBe('PERSISTIDA')
    expect(rpc).toHaveBeenCalledWith('vortx_encerrar_carteira', { p_id: jobId, p_lease: lease })
    expect(remove).not.toHaveBeenCalled()
  })
  it('rollback confirmado encerra antes de remover somente seu arquivo', async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === 'vortx_reservar_carteira' ? job : name === 'vortx_concluir_carteira' ? null : { estado: 'FALHA', id: null, podeRemoverArquivo: true }, error: name === 'vortx_concluir_carteira' ? { message: 'fail' } : null }))
    await expect(consultarEPersistirCarteiraVortx(input)).rejects.toThrow('CARTEIRA_NAO_PERSISTIDA_EXECUCAO_ENCERRADA')
    expect(remove).toHaveBeenCalledExactlyOnceWith([job.storage_path])
    expect(rpc.mock.invocationCallOrder.at(-1)!).toBeLessThan(remove.mock.invocationCallOrder[0])
  })
  it('resultado indeterminado preserva original e manifesto, sem compensacao cega', async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === 'vortx_reservar_carteira' ? job : null, error: name === 'vortx_reservar_carteira' ? null : { message: 'unavailable' } }))
    await expect(consultarEPersistirCarteiraVortx(input)).rejects.toThrow('CARTEIRA_RESULTADO_INDETERMINADO_ORIGINAL_PRESERVADO')
    expect(remove).not.toHaveBeenCalled()
  })
  it('duplicata nao sobrescreve original: remove apenas a nova copia apos fencing', async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === 'vortx_reservar_carteira' ? job : name === 'vortx_concluir_carteira' ? { id: oldId, estado: 'DUPLICADA', duplicada: true } : { estado: 'DUPLICADA', id: oldId, podeRemoverArquivo: true }, error: null }))
    expect((await consultarEPersistirCarteiraVortx(input)).estado).toBe('DUPLICADA')
    expect(remove).toHaveBeenCalledExactlyOnceWith([job.storage_path])
  })
  it('falha na compensacao nao repete exclusao nem declara sucesso', async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === 'vortx_reservar_carteira' ? job : name === 'vortx_concluir_carteira' ? { id: oldId, estado: 'DUPLICADA', duplicada: true } : { estado: 'DUPLICADA', id: oldId, podeRemoverArquivo: true }, error: null }))
    remove.mockResolvedValue({ error: { message: 'unavailable' } })
    await expect(consultarEPersistirCarteiraVortx(input)).rejects.toThrow('CARTEIRA_COMPENSACAO_PENDENTE_MANIFESTO_PRESERVADO')
    expect(remove).toHaveBeenCalledOnce()
  })
  it('recusa confirmacao contraditoria que permitiria excluir original publicado', async () => {
    rpc.mockImplementation(async (name: string) => ({ data: name === 'vortx_reservar_carteira' ? job : name === 'vortx_concluir_carteira' ? null : { estado: 'PERSISTIDA', id: jobId, podeRemoverArquivo: true }, error: null }))
    await expect(consultarEPersistirCarteiraVortx(input)).rejects.toThrow('CARTEIRA_RESULTADO_INDETERMINADO_ORIGINAL_PRESERVADO')
    expect(remove).not.toHaveBeenCalled()
  })
  it('falha de transporte no fencing preserva arquivo com erro seguro', async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === 'vortx_encerrar_carteira') throw new Error('network detail')
      return { data: name === 'vortx_reservar_carteira' ? job : null, error: null }
    })
    await expect(consultarEPersistirCarteiraVortx(input)).rejects.toThrow('CARTEIRA_RESULTADO_INDETERMINADO_ORIGINAL_PRESERVADO')
    expect(remove).not.toHaveBeenCalled()
  })
})
