import { beforeEach, describe, expect, it, vi } from 'vitest'
import { htmlParaPdf } from './gerarContrato'
import { createPdfTelemetry, type PdfLogEvent } from './pdf-telemetry'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(), launch: vi.fn(), stat: vi.fn(), close: vi.fn(), newPage: vi.fn(),
  setContent: vi.fn(), waitForNetworkIdle: vi.fn(), pdf: vi.fn(),
}))
vi.mock('@sparticuz/chromium', () => ({ default: { executablePath: mocks.resolve, args: ['--no-sandbox'] } }))
vi.mock('puppeteer-core', () => ({ default: { launch: mocks.launch } }))
vi.mock('node:fs/promises', () => ({ stat: mocks.stat }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('CHROME_PATH', '')
  vi.stubEnv('CHROMIUM_BINARY_URL', '')
  mocks.resolve.mockResolvedValue('/tmp/chromium')
  mocks.stat.mockResolvedValue({ size: 100, mode: 0o100700, mtimeMs: 123, isFile: () => true })
  mocks.launch.mockResolvedValue({ newPage: mocks.newPage, close: mocks.close })
  mocks.newPage.mockResolvedValue({ setContent: mocks.setContent, waitForNetworkIdle: mocks.waitForNetworkIdle, pdf: mocks.pdf })
  mocks.pdf.mockResolvedValue(Buffer.from('%PDF-fixture'))
})

describe('boundary central de observabilidade PDF', () => {
  it('mantém launch, conteúdo, opções PDF e fechamento; registra estágios sem HTML', async () => {
    const events: PdfLogEvent[] = []
    const telemetry = createPdfTelemetry('termo_cessao', (event) => events.push(event))
    expect(await htmlParaPdf('<html>private legal document</html>', telemetry)).toEqual(Buffer.from('%PDF-fixture'))
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith()
    expect(mocks.stat).toHaveBeenCalledExactlyOnceWith('/tmp/chromium')
    expect(mocks.launch).toHaveBeenCalledExactlyOnceWith({
      args: ['--no-sandbox'], defaultViewport: { width: 1280, height: 720 }, executablePath: '/tmp/chromium', headless: true,
    })
    expect(mocks.setContent).toHaveBeenCalledExactlyOnceWith('<html>private legal document</html>', { waitUntil: 'load' })
    expect(mocks.waitForNetworkIdle).toHaveBeenCalledExactlyOnceWith({ idleTime: 500, timeout: 30_000 })
    expect(mocks.pdf).toHaveBeenCalledExactlyOnceWith({ format: 'A4', printBackground: true, preferCSSPageSize: true })
    expect(mocks.close).toHaveBeenCalledTimes(1)
    expect(events.map((event) => event.event)).toEqual([
      'PDF_RESOLVE_CHROMIUM_START', 'PDF_RESOLVE_CHROMIUM_SUCCESS', 'PDF_EXECUTABLE_STAT',
      'PDF_LAUNCH_START', 'PDF_LAUNCH_SUCCESS', 'PDF_PAGE_CREATED', 'PDF_CONTENT_SET', 'PDF_RENDER_SUCCESS',
      'PDF_BROWSER_CLOSE_START', 'PDF_BROWSER_CLOSE_SUCCESS',
    ])
    expect(JSON.stringify(events)).not.toContain('private legal document')
  })

  it('captura ETXTBSY e resolvedExecutablePath, não repete launch nem troca o erro', async () => {
    const events: PdfLogEvent[] = []
    const error = Object.assign(new Error('spawn ETXTBSY'), { code: 'ETXTBSY', errno: -26, syscall: 'spawn', path: '/tmp/chromium' })
    mocks.launch.mockRejectedValue(error)
    await expect(htmlParaPdf('private', createPdfTelemetry('pdf', (event) => events.push(event)))).rejects.toBe(error)
    expect(mocks.launch).toHaveBeenCalledTimes(1)
    expect(mocks.close).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({
      event: 'PDF_LAUNCH_ERROR', resolvedExecutablePath: '/tmp/chromium', executableStat: { exists: true, size: 100 },
      error: { code: 'ETXTBSY', errno: -26, syscall: 'spawn', path: '/tmp/chromium' },
    })
  })

  it('erro de stat é diagnóstico e não bloqueia launch', async () => {
    mocks.stat.mockRejectedValue(Object.assign(new Error('stat failed'), { code: 'EACCES', syscall: 'stat' }))
    const events: PdfLogEvent[] = []
    await expect(htmlParaPdf('fixture', createPdfTelemetry('pdf', (event) => events.push(event)))).resolves.toEqual(Buffer.from('%PDF-fixture'))
    expect(events.find((event) => event.event === 'PDF_LAUNCH_START')?.executableStat).toMatchObject({ exists: null, error: { code: 'EACCES' } })
  })

  it.each(['setContent', 'pdf', 'close'] as const)('preserva falha e fechamento no estágio %s', async (stage) => {
    const error = new Error('original error')
    mocks[stage].mockRejectedValue(error)
    const events: PdfLogEvent[] = []
    await expect(htmlParaPdf('fixture', createPdfTelemetry('pdf', (event) => events.push(event)))).rejects.toBe(error)
    expect(mocks.close).toHaveBeenCalledTimes(1)
    expect(events.some((event) => event.event === (stage === 'close' ? 'PDF_BROWSER_CLOSE_ERROR' : 'PDF_RENDER_ERROR'))).toBe(true)
  })
})
