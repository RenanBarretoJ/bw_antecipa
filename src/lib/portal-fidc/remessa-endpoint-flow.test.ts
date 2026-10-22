import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { from, rpc, download, decrypt, securityEvent } = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), download: vi.fn(), decrypt: vi.fn(), securityEvent: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({
  from, rpc, storage: { from: () => ({ download }) },
}) }))
vi.mock('@/lib/portal-fidc/credenciais', () => ({ descriptografarPortalFidcValor: decrypt }))
vi.mock('@/lib/auth/mfa', () => ({ registrarEventoSeguranca: securityEvent }))

import { enviarRemessaPortalFidc, sha256Hex } from './integracao'

const cnab = Buffer.from('CNAB SOMENTE SINTETICO\r\n')
const nomeArquivo = 'REM_QA_12345678_20261022.REM'
const updates: Array<{ table: string; values: Record<string, unknown> }> = []
const inserts: Array<{ table: string; values: Record<string, unknown> }> = []
let endpoint: string
let previous: { id: string; status: string; protocolo_externo: string } | null
let credentialFund: string
let recordedHash: string
let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>

function configurarBancoSintetico() {
  rpc.mockImplementation(async () => ({ data: {
    status: 'CONFIGURADA', integracao_fundo_id: 'integracao-qa', integracao_fundo_versao_id: 'versao-qa',
    provider_key: 'SINQIA', system_name: 'Portal FIDC', adapter_key: 'sinqia_portal_fidc',
    endpoint_base: endpoint, credential_ref: 'referencia-qa', credencial_integracao_id: 'credencial-qa',
    identificador_cliente: 'QA', codigo_originador: '001', versao: 1, configuracao_nao_sensivel: {},
  }, error: null }))
  from.mockImplementation((table: string) => {
    const result = Promise.resolve({ data: null, error: null })
    const query = {
      select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(),
      update: vi.fn(), insert: vi.fn(), maybeSingle: vi.fn(), single: vi.fn(),
      then: result.then.bind(result),
    }
    for (const method of [query.select, query.eq, query.order, query.limit]) method.mockReturnValue(query)
    query.update.mockImplementation((values: Record<string, unknown>) => { updates.push({ table, values }); return query })
    query.insert.mockImplementation((values: Record<string, unknown>) => { inserts.push({ table, values }); return query })
    query.single.mockResolvedValue({ data: { id: 'execucao-qa', iniciada_em: new Date().toISOString() }, error: null })
    query.maybeSingle.mockImplementation(async () => {
      if (table === 'remessas_cnab_operacoes') return { data: { remessa: {
        id: 'remessa-qa', fundo_id: 'fundo-qa', status: 'gerada', nome_arquivo: nomeArquivo,
        bucket: 'bucket-qa', storage_path: 'qa/sintetico.rem', sha256: recordedHash,
        fundo: { cnpj: '00000000000000' },
        configuracao: { codigo_originador: '001', tipo_recebivel: '01', status: 'publicada' },
      } }, error: null }
      if (table === 'credenciais_integracao') return { data: {
        id: 'credencial-qa', fundo_id: credentialFund, integracao_fundo_id: 'integracao-qa',
        ambiente: 'producao', status: 'ativa', usuario_criptografado: 'usuario-cifrado-qa',
        senha_criptografada: 'senha-cifrada-qa', chave_versao: 'qa',
      }, error: null }
      if (table === 'integracao_execucoes') return { data: previous, error: null }
      throw new Error(`Tabela inesperada no teste: ${table}`)
    })
    return query
  })
}

describe('envio de CNAB ao endereco SOAP correto (HTTP e banco simulados)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('INTEGRATION_RUNTIME_ENV', 'producao')
    endpoint = 'https://provider.example/servicos/soap/'
    previous = null
    credentialFund = 'fundo-qa'
    recordedHash = sha256Hex(cnab)
    updates.length = 0
    inserts.length = 0
    decrypt.mockImplementation((value: string) => value === 'usuario-cifrado-qa' ? 'usuario-sintetico' : 'senha-sintetica')
    download.mockResolvedValue({ data: new Blob([new Uint8Array(cnab)]), error: null })
    securityEvent.mockResolvedValue(undefined)
    fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      '<S:Envelope><S:Body><idArquivo>12345</idArquivo><mensagem>Recebido QA</mensagem></S:Body></S:Envelope>',
      { status: 200 },
    ))
    vi.stubGlobal('fetch', fetchSpy)
    configurarBancoSintetico()
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it.each([
    'https://provider.example/servicos/soap/',
    'https://provider.example/servicos/soap/importacaoArquivoRemessa',
    'https://provider.example/servicos/soap/importacaoArquivoRemessa?wsdl',
  ])('envia uma vez, com envelope, credencial e ZIP preservados: %s', async (base) => {
    endpoint = base
    await expect(enviarRemessaPortalFidc('operacao-qa')).resolves.toMatchObject({ idArquivo: '12345' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, request] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://provider.example/servicos/soap/importacaoArquivoRemessa')
    expect(request).toMatchObject({ method: 'POST', headers: {
      'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '',
      username: 'usuario-sintetico', password: 'senha-sintetica',
    } })
    const body = String(request?.body)
    expect(body).toContain('<soap:importarArquivoRemessa>')
    expect(body).toContain('<tipoRecebivel>01</tipoRecebivel>')
    expect(body).toContain('<cnpjFundo>00000000000000</cnpjFundo>')
    expect(body).not.toContain('senha-sintetica')
    const archive = await JSZip.loadAsync(Buffer.from(body.match(/<arquivo>([^<]+)<\/arquivo>/)![1], 'base64'))
    expect(Object.keys(archive.files)).toEqual([nomeArquivo])
    expect(await archive.file(nomeArquivo)!.async('nodebuffer')).toEqual(cnab)
    expect(inserts).toEqual([expect.objectContaining({ table: 'integracao_execucoes', values: expect.objectContaining({
      fundo_id: 'fundo-qa', integracao_fundo_versao_id: 'versao-qa', remessa_cnab_id: 'remessa-qa',
      operacao_id: 'operacao-qa', tentativa: 1,
      idempotency_key: sha256Hex('envio_remessa:remessa-qa:versao-qa'),
    }) })])
    expect(updates).toContainEqual(expect.objectContaining({ table: 'remessas_cnab', values: expect.objectContaining({ status: 'enviada' }) }))
  })

  it('preserva endpoint personalizado explicito', async () => {
    endpoint = 'https://custom.example/proxy/importacao'
    await enviarRemessaPortalFidc('operacao-qa')
    expect(fetchSpy.mock.calls[0][0]).toBe(endpoint)
  })

  it('404 permanece falha, sem retry automatico nem marcacao falsa de sucesso', async () => {
    fetchSpy.mockResolvedValue(new Response('<html><h1>404 Not Found: Invalid Request</h1></html>', { status: 404 }))
    await expect(enviarRemessaPortalFidc('operacao-qa')).rejects.toThrow('Portal FIDC HTTP 404')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(inserts).toHaveLength(1)
    expect(updates).toContainEqual(expect.objectContaining({ table: 'remessas_cnab', values: expect.objectContaining({ status: 'erro' }) }))
    expect(updates.filter(({ table }) => table === 'operacoes')).toEqual([])
    expect(updates.some(({ values }) => values.status === 'sucesso' || values.status === 'enviada')).toBe(false)
  })

  it('resposta HTTP 200 sem protocolo continua falhando', async () => {
    fetchSpy.mockResolvedValue(new Response('<mensagem>Processamento nao confirmado</mensagem>', { status: 200 }))
    await expect(enviarRemessaPortalFidc('operacao-qa')).rejects.toMatchObject({
      categoria: 'resposta_inesperada', message: 'Portal FIDC SOAP: Processamento nao confirmado',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(updates.some(({ values }) => values.status === 'enviada')).toBe(false)
  })

  it('sucesso anterior idempotente nao relê credenciais nem reenvia', async () => {
    previous = { id: 'execucao-anterior-qa', status: 'sucesso', protocolo_externo: '12345' }
    await expect(enviarRemessaPortalFidc('operacao-qa')).resolves.toMatchObject({ idArquivo: '12345' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(decrypt).not.toHaveBeenCalled()
    expect(inserts).toEqual([])
  })

  it('tentativa em estado incerto nao reenvia', async () => {
    previous = { id: 'execucao-incerta-qa', status: 'iniciada', protocolo_externo: '' }
    await expect(enviarRemessaPortalFidc('operacao-qa')).rejects.toThrow('estado incerto')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(decrypt).not.toHaveBeenCalled()
  })

  it('credencial de outro Fundo continua bloqueada antes de download ou HTTP', async () => {
    credentialFund = 'outro-fundo-qa'
    await expect(enviarRemessaPortalFidc('operacao-qa')).rejects.toThrow('incompatível com fundo')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
    expect(decrypt).not.toHaveBeenCalled()
  })

  it('hash divergente continua bloqueado antes de HTTP', async () => {
    recordedHash = sha256Hex('CONTEUDO DIFERENTE')
    await expect(enviarRemessaPortalFidc('operacao-qa')).rejects.toThrow('SHA-256')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
