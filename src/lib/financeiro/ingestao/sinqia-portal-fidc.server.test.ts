import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integracoes/credentials.server', () => ({ resolverCredencialIntegracaoSegura: vi.fn() }))

import { createSinqiaPortalFidcFinancialHandlers, extrairCsvSinqia, parseMtomResponse, resolverConfiguracaoRelatoriosSinqia } from './sinqia-portal-fidc.server'

const fundoId = crypto.randomUUID()
const version = {
  fundoId, integrationId: crypto.randomUUID(), integrationVersionId: crypto.randomUUID(),
  providerKey: 'SINQIA', systemName: 'Portal FIDC', adapterKey: 'sinqia_portal_fidc', environment: 'homologacao' as const,
  capability: 'ESTOQUE' as const, version: 3, endpointBase: 'https://portal.example.test', clientIdentifier: 'cliente',
  originatorCode: '0001', credentialReference: 'credencial:teste', credentialId: crypto.randomUUID(),
  config: { relatorios_financeiros: { cnpj_fundo: '00123456000199', intervalo_polling_ms: 500, timeout_polling_ms: 5000 } },
}

async function zipWith(name: string, content: Uint8Array) {
  const zip = new JSZip()
  zip.file(name, content)
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

describe('adapter financeiro Portal FIDC/Sinqia', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('declara handlers reais somente para estoque, aquisicoes e liquidacoes', () => {
    const handlers = createSinqiaPortalFidcFinancialHandlers({ resolveCredential: vi.fn(), fetcher: vi.fn(), sleep: vi.fn() })
    expect(handlers.map((item) => item.capability)).toEqual(['ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'])
    expect(handlers.some((item) => item.capability === 'CARTEIRA')).toBe(false)
  })

  it.each([
    ['ESTOQUE', 'SEU_NUMERO;DATA_REFERENCIA;VALOR_NOMINAL\r\nT1;2026-08-13;100,00\r\n', 'relatorioEstoque', 'dataReferencia'],
    ['AQUISICOES', 'ID_FUNDO;ENTRADA;VALOR_COMPRA\r\nF1;13/08/2026;100,00\r\n', 'relatorioAquisicaoLiquidados', '<tipoRelatorio>1</tipoRelatorio>'],
    ['LIQUIDACOES', 'DATA_MOVIMENTO;TIPO_MOVIMENTO;VALOR_PAGO\r\n13/08/2026;BAIXA;100,00\r\n', 'relatorioAquisicaoLiquidados', '<tipoMovimento>BAIXA</tipoMovimento>'],
  ] as const)('agenda, consulta, baixa e preserva os bytes originais de %s', async (capability, csv, expectedPath, expectedBody) => {
    const original = new TextEncoder().encode(csv)
    const zip = await zipWith(`${capability.toLowerCase()}.csv`, original)
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('<idAgendamento>AG-1</idAgendamento>', { status: 200 }))
      .mockResolvedValueOnce(new Response('<idMensagem>5</idMensagem>', { status: 200 }))
      .mockResolvedValueOnce(new Response(`<arquivo>${Buffer.from(zip).toString('base64')}</arquivo>`, { status: 200, headers: { 'content-type': 'text/xml' } }))
    const handler = createSinqiaPortalFidcFinancialHandlers({
      fetcher: fetcher as typeof fetch,
      resolveCredential: vi.fn().mockResolvedValue({ username: 'usuario-secreto', password: 'senha-secreta' }),
      sleep: vi.fn(),
    }).find((item) => item.capability === capability)!
    const result = await handler.obterArquivo({ dataOperacional: '2026-08-14', dataReferencia: '2026-08-13', integrationVersion: { ...version, capability } })
    expect(result.conteudo).toEqual(original)
    expect(result.fundoId).toBe(fundoId)
    expect(String(fetcher.mock.calls[0][0])).toContain(expectedPath)
    expect(String(fetcher.mock.calls[0][1]?.body)).toContain(expectedBody)
    expect(String(fetcher.mock.calls[0][1]?.body)).toContain('<cnpjFundo>00123456000199</cnpjFundo>')
  })

  it('falha fechado quando o ZIP nao possui arquivo inequivocamente compativel', async () => {
    const zip = await zipWith('outro.csv', new TextEncoder().encode('COLUNA;OUTRA\n1;2\n'))
    await expect(extrairCsvSinqia(zip, 'ESTOQUE')).rejects.toThrow('sem CSV compativel')
  })

  it('nao usa ambiente ou nome do fundo como substituto do CNPJ versionado', () => {
    expect(() => resolverConfiguracaoRelatoriosSinqia({ ...version, config: {} })).toThrow('relatorios_financeiros')
    expect(() => resolverConfiguracaoRelatoriosSinqia({ ...version, config: { relatorios_financeiros: { cnpj_fundo: '123' } } })).toThrow('CNPJ do fundo invalido')
  })

  it('separa a parte binaria da resposta MTOM', () => {
    const boundary = 'boundary-test'
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/xop+xml\r\n\r\n<arquivo><xop:Include href="cid:bin"/></arquivo>\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from([1, 2, 3, 4]),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const parsed = parseMtomResponse(body, `multipart/related; boundary="${boundary}"`)
    expect(parsed.xml).toContain('xop:Include')
    expect(parsed.binary).toEqual(Buffer.from([1, 2, 3, 4]))
  })
})
