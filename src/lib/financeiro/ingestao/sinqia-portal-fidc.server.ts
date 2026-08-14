import 'server-only'

import JSZip from 'jszip'
import { resolverCredencialIntegracaoSegura } from '@/lib/integracoes/credentials.server'
import type { FinancialIntegrationCapability } from '@/lib/integracoes/capabilities'
import type { ResolvedIntegrationVersion } from '@/lib/integracoes/resolver.server'
import type { FinancialCapabilityHandler, FinancialCapabilityRequest } from './provider'

const ADAPTER_KEY = 'sinqia_portal_fidc'
const SOAP_NAMESPACE = 'http://soap.consulta.servicos.portal.fidc.fromtis.com.br/'
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024

export type SinqiaProviderErrorCode = 'FALHA_AUTENTICACAO' | 'RELATORIO_FALHOU' | 'ARQUIVO_INVALIDO' | 'LAYOUT_NAO_SUPORTADO' | 'CONFIGURACAO_INVALIDA' | 'TIMEOUT'

export class SinqiaProviderError extends Error {
  constructor(public readonly code: SinqiaProviderErrorCode, message: string) {
    super(message)
    this.name = 'SinqiaProviderError'
  }
}

type SupportedCapability = Extract<FinancialIntegrationCapability, 'ESTOQUE' | 'AQUISICOES' | 'LIQUIDACOES'>
type Credential = { username: string; password: string }
type Fetcher = typeof fetch

type Dependencies = {
  fetcher?: Fetcher
  resolveCredential?: (version: ResolvedIntegrationVersion) => Promise<Credential>
  sleep?: (milliseconds: number) => Promise<void>
}

type ReportConfig = {
  cnpjFundo: string
  cpfCnpjCedente: string | null
  pollingIntervalMs: number
  pollingTimeoutMs: number
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback
}

export function resolverConfiguracaoRelatoriosSinqia(version: ResolvedIntegrationVersion): ReportConfig {
  const reports = object(version.config.relatorios_financeiros)
  if (!reports) throw new SinqiaProviderError('CONFIGURACAO_INVALIDA', 'Configuracao relatorios_financeiros ausente na versao da integracao.')
  const cnpjFundo = typeof reports.cnpj_fundo === 'string' ? reports.cnpj_fundo.replace(/\D/g, '') : ''
  if (!/^\d{14}$/.test(cnpjFundo)) throw new SinqiaProviderError('CONFIGURACAO_INVALIDA', 'CNPJ do fundo invalido na configuracao versionada da integracao.')
  const cedente = typeof reports.cpf_cnpj_cedente === 'string' ? reports.cpf_cnpj_cedente.replace(/\D/g, '') : ''
  if (cedente && !/^\d{11}(?:\d{3})?$/.test(cedente)) {
    throw new SinqiaProviderError('CONFIGURACAO_INVALIDA', 'CPF/CNPJ do cedente invalido na configuracao versionada da integracao.')
  }
  return {
    cnpjFundo,
    cpfCnpjCedente: cedente || null,
    pollingIntervalMs: boundedInteger(reports.intervalo_polling_ms, 5_000, 500, 30_000),
    pollingTimeoutMs: boundedInteger(reports.timeout_polling_ms, 105_000, 5_000, 110_000),
  }
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  })[character]!)
}

function envelope(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="${SOAP_NAMESPACE}"><soapenv:Header/><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`
}

function endpoint(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}${path}`
}

function extractTag(xml: string, tag: string) {
  return xml.match(new RegExp(`<(?:[A-Za-z0-9_-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${tag}>`, 'i'))?.[1]?.trim()
}

function sanitizedProviderMessage(value: string | undefined) {
  return (value || 'resposta sem mensagem')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(password|senha|username|usuario|token)\s*[:=]\s*\S+/gi, '$1=[redigido]')
    .slice(0, 300)
}

async function responseBytes(response: Response) {
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('Resposta Sinqia excedeu o limite permitido.')
  return bytes
}

async function callSoap(input: {
  base: string
  path: string
  body: string
  credential: Credential
  fetcher: Fetcher
}) {
  const response = await input.fetcher(endpoint(input.base, input.path), {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '',
      username: input.credential.username,
      password: input.credential.password,
    },
    body: envelope(input.body),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  })
  const text = new TextDecoder().decode(await responseBytes(response))
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? 'FALHA_AUTENTICACAO' : 'RELATORIO_FALHOU'
    throw new SinqiaProviderError(code, `Portal FIDC respondeu HTTP ${response.status}: ${sanitizedProviderMessage(extractTag(text, 'faultstring'))}`)
  }
  return text
}

export function parseMtomResponse(bytes: Uint8Array, contentType: string) {
  const buffer = Buffer.from(bytes)
  const boundary = contentType.match(/boundary="?([^";,\s]+)"?/i)?.[1]
  if (!boundary) return { xml: buffer.toString('utf8'), binary: null as Buffer | null }
  const marker = Buffer.from(`--${boundary}`, 'ascii')
  const headerSeparator = Buffer.from('\r\n\r\n', 'ascii')
  const positions: number[] = []
  let cursor = 0
  while (cursor < buffer.length) {
    const position = buffer.indexOf(marker, cursor)
    if (position < 0) break
    positions.push(position)
    cursor = position + marker.length
  }
  let xml = ''
  let binary: Buffer | null = null
  for (let index = 0; index < positions.length; index += 1) {
    const start = positions[index] + marker.length
    const end = index + 1 < positions.length ? positions[index + 1] : buffer.length
    const part = buffer.subarray(start, end)
    const headerEnd = part.indexOf(headerSeparator)
    if (headerEnd < 0) continue
    const headers = part.subarray(0, headerEnd).toString('ascii').toLowerCase()
    let content = part.subarray(headerEnd + headerSeparator.length)
    while (content.length >= 2 && content.subarray(content.length - 2).equals(Buffer.from('\r\n'))) {
      content = content.subarray(0, content.length - 2)
    }
    if (headers.includes('application/xop+xml') || headers.includes('text/xml')) xml = content.toString('utf8').trim()
    else if (content.length) binary = Buffer.from(content)
  }
  return { xml: xml || buffer.toString('utf8'), binary }
}

async function callSoapMtom(input: {
  base: string
  path: string
  body: string
  credential: Credential
  fetcher: Fetcher
}) {
  const boundary = `----=_Part_${crypto.randomUUID().replace(/-/g, '')}`
  const payload = [
    `--${boundary}`,
    'Content-Type: application/xop+xml; charset=UTF-8; type="text/xml"',
    'Content-Transfer-Encoding: 8bit',
    'Content-ID: <rootpart@bw-antecipa>',
    '',
    envelope(input.body),
    `--${boundary}--`,
    '',
  ].join('\r\n')
  const response = await input.fetcher(endpoint(input.base, input.path), {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; type="application/xop+xml"; boundary="${boundary}"; start="<rootpart@bw-antecipa>"; start-info="text/xml"`,
      Accept: '*/*',
      username: input.credential.username,
      password: input.credential.password,
    },
    body: payload,
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  })
  const bytes = await responseBytes(response)
  const parsed = parseMtomResponse(bytes, response.headers.get('content-type') || '')
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? 'FALHA_AUTENTICACAO' : 'RELATORIO_FALHOU'
    throw new SinqiaProviderError(code, `Portal FIDC respondeu HTTP ${response.status}: ${sanitizedProviderMessage(extractTag(parsed.xml, 'faultstring'))}`)
  }
  return parsed
}

function scheduleBody(capability: SupportedCapability, date: string, config: ReportConfig) {
  const cedente = config.cpfCnpjCedente
    ? `<cpfCnpjCedente>${escapeXml(config.cpfCnpjCedente)}</cpfCnpjCedente>`
    : ''
  if (capability === 'ESTOQUE') {
    return {
      path: '/agendador/relatorioEstoque?wsdl',
      body: `<soap:agendadorRelatorioEstoque><requisicaoRelatorioEstoque><cnpjFundo>${config.cnpjFundo}</cnpjFundo><dataReferencia>${escapeXml(date)}</dataReferencia>${cedente}<tipoArquivo>CSV</tipoArquivo></requisicaoRelatorioEstoque></soap:agendadorRelatorioEstoque>`,
    }
  }
  const reportType = capability === 'AQUISICOES' ? '1' : '2'
  const movement = capability === 'LIQUIDACOES' ? '<tipoMovimento>BAIXA</tipoMovimento>' : ''
  return {
    path: '/agendador/relatorioAquisicaoLiquidados?wsdl',
    body: `<soap:agendadorRelatorioAquisicaoLiquidados><requisicaoRelatorioAquisicaoLiquidados><tipoRelatorio>${reportType}</tipoRelatorio><cnpjFundo>${config.cnpjFundo}</cnpjFundo><dataDe>${escapeXml(date)}</dataDe><dataAte>${escapeXml(date)}</dataAte>${cedente}${movement}<tipoArquivo>CSV</tipoArquivo></requisicaoRelatorioAquisicaoLiquidados></soap:agendadorRelatorioAquisicaoLiquidados>`,
  }
}

function headerMatches(capability: SupportedCapability, bytes: Uint8Array) {
  const header = new TextDecoder('windows-1252').decode(bytes).split(/\r?\n/, 1)[0]?.toUpperCase() || ''
  if (capability === 'ESTOQUE') return header.includes('SEU_NUMERO') && header.includes('DATA_REFERENCIA')
  if (capability === 'AQUISICOES') return header.includes('ID_FUNDO') && header.includes('ENTRADA')
  return header.includes('DATA_MOVIMENTO') && header.includes('TIPO_MOVIMENTO')
}

export async function extrairCsvSinqia(zipBytes: Uint8Array, capability: SupportedCapability) {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(zipBytes)
  } catch {
    throw new SinqiaProviderError('ARQUIVO_INVALIDO', 'O download Sinqia nao retornou um ZIP valido.')
  }
  const candidates: Array<{ name: string; bytes: Uint8Array }> = []
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.toLowerCase().endsWith('.csv')) continue
    const bytes = await entry.async('uint8array')
    if (headerMatches(capability, bytes)) candidates.push({ name: entry.name, bytes })
  }
  if (candidates.length === 0) throw new SinqiaProviderError('LAYOUT_NAO_SUPORTADO', `ZIP Sinqia sem CSV compativel com ${capability}.`)
  if (candidates.length > 1) throw new SinqiaProviderError('ARQUIVO_INVALIDO', `ZIP Sinqia ambiguo: mais de um CSV compativel com ${capability}.`)
  return candidates[0]
}

async function obterRelatorio(
  capability: SupportedCapability,
  input: FinancialCapabilityRequest,
  dependencies: Required<Dependencies>,
) {
  const config = resolverConfiguracaoRelatoriosSinqia(input.integrationVersion)
  const credential = await dependencies.resolveCredential(input.integrationVersion)
  const scheduled = scheduleBody(capability, input.dataReferencia, config)
  const scheduleResponse = await callSoap({
    base: input.integrationVersion.endpointBase,
    path: scheduled.path,
    body: scheduled.body,
    credential,
    fetcher: dependencies.fetcher,
  })
  const scheduleId = extractTag(scheduleResponse, 'idAgendamento')
  if (!scheduleId) {
    throw new SinqiaProviderError('RELATORIO_FALHOU', `Agendamento Sinqia rejeitado: ${sanitizedProviderMessage(extractTag(scheduleResponse, 'descricaoRetorno'))}`)
  }

  const startedAt = Date.now()
  while (true) {
    const pollResponse = await callSoap({
      base: input.integrationVersion.endpointBase,
      path: '/agendador/consultarRelatorio?wsdl',
      body: `<soap:consultarRelatorio><requisicaoConsultaRelatorio><idAgendamento>${escapeXml(scheduleId)}</idAgendamento></requisicaoConsultaRelatorio></soap:consultarRelatorio>`,
      credential,
      fetcher: dependencies.fetcher,
    })
    const status = extractTag(pollResponse, 'idMensagem') || ''
    if (status === '5') break
    if (status === '4') throw new SinqiaProviderError('RELATORIO_FALHOU', `Geracao Sinqia falhou: ${sanitizedProviderMessage(extractTag(pollResponse, 'mensagem'))}`)
    if (Date.now() - startedAt >= config.pollingTimeoutMs) throw new SinqiaProviderError('TIMEOUT', 'Timeout aguardando a geracao do relatorio Sinqia.')
    await dependencies.sleep(config.pollingIntervalMs)
  }

  const downloaded = await callSoapMtom({
    base: input.integrationVersion.endpointBase,
    path: '/agendador/realizarDownload?wsdl',
    body: `<soap:realizarDownload><requisicaoDownloadRelatorio><idAgendamento>${escapeXml(scheduleId)}</idAgendamento></requisicaoDownloadRelatorio></soap:realizarDownload>`,
    credential,
    fetcher: dependencies.fetcher,
  })
  const embedded = extractTag(downloaded.xml, 'arquivo')
  const zipBytes = embedded ? Buffer.from(embedded, 'base64') : downloaded.binary
  if (!zipBytes?.byteLength) throw new SinqiaProviderError('ARQUIVO_INVALIDO', 'Download Sinqia concluido sem arquivo binario.')
  const csv = await extrairCsvSinqia(zipBytes, capability)
  return {
    fundoId: input.integrationVersion.fundoId,
    provedor: input.integrationVersion.providerKey,
    tipoBase: capability,
    dataReferencia: input.dataReferencia,
    nomeArquivo: csv.name.split(/[\\/]/).pop() || `${capability.toLowerCase()}.csv`,
    mimeType: 'text/csv',
    conteudo: csv.bytes,
  }
}

export function createSinqiaPortalFidcFinancialHandlers(dependencies: Dependencies = {}): FinancialCapabilityHandler[] {
  const resolved: Required<Dependencies> = {
    fetcher: dependencies.fetcher || fetch,
    resolveCredential: dependencies.resolveCredential || (async (version) => resolverCredencialIntegracaoSegura(version)),
    sleep: dependencies.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
  }
  return (['ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'] as const).map((capability) => ({
    adapterKey: ADAPTER_KEY,
    capability,
    obterArquivo: (input) => obterRelatorio(capability, input, resolved),
  }))
}
