import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPdfTelemetry, sanitizePdfError, type PdfLogEvent } from './pdf-telemetry'

afterEach(() => vi.unstubAllEnvs())

describe('telemetria sanitizada de PDF', () => {
  it('preserva os campos reais de spawn sem serializar os demais dados do erro', () => {
    const error = Object.assign(new Error('spawn ETXTBSY'), {
      code: 'ETXTBSY', errno: -26, syscall: 'spawn', path: '/tmp/chromium',
      spawnargs: ['--no-sandbox', '--user-data-dir=/tmp/profile', 'https://private.test?token=secret'],
      html: '<html>documento privado</html>',
      stack: 'Error: spawn ETXTBSY\n    at ChildProcess.spawn (node:internal/child_process:420:11)\n    at launch (/var/task/node_modules/browser/launch.js:80:12)',
    })
    expect(sanitizePdfError(error)).toEqual({
      name: 'Error', message: 'spawn ETXTBSY', code: 'ETXTBSY', errno: -26, syscall: 'spawn',
      path: '/tmp/chromium', spawnargs: ['--no-sandbox', '--user-data-dir=[REDACTED]', '[REDACTED]'],
      stack: 'Error: spawn ETXTBSY\n    at node:internal/child_process:420:11\n    at /var/task/node_modules/browser/launch.js:80:12',
    })
  })

  it('remove mensagem livre, HTML, URLs, credenciais e identidade local da stack/path', () => {
    vi.stubEnv('CHROMIUM_BINARY_URL', 'https://pack.test/private?token=private-token')
    vi.stubEnv('TEST_API_KEY', 'sensitive-value')
    const error = Object.assign(new Error('<html>12.345.678/0001-90 banco 123 https://pack.test/private?token=private-token</html>'), {
      path: '/tmp/sensitive-value/chromium',
      spawnargs: ['--proxy-server=https://user:password@proxy.test', 'private-token', '<html>'],
      stack: 'Error: private-token\n    at launch (C:\\Users\\private-person\\src\\file.ts:2:3)\n    at evil https://test?token=secret',
    })
    const safe = sanitizePdfError(error)
    const serialized = JSON.stringify(safe)
    for (const secret of ['private-person', 'sensitive-value', 'private-token', 'password', '<html>', '12.345.678', 'banco 123']) {
      expect(serialized).not.toContain(secret)
    }
    expect(safe.path).toBe('/tmp/[REDACTED]/chromium')
    expect(safe.stack).toContain('src\\file.ts:2:3')
    expect(sanitizePdfError('secret').message).toBe('[REDACTED]')
  })

  it('observa duas resoluções simultâneas e launch sobreposto sem bloquear nenhuma ação', async () => {
    const events: PdfLogEvent[] = []
    const a = createPdfTelemetry('termo_cessao', (event) => events.push(event))
    const b = createPdfTelemetry('notificacao_sacado', (event) => events.push(event))
    let releaseA!: (path: string) => void
    let releaseB!: (path: string) => void
    const resolutionA = a.observe('RESOLVE_CHROMIUM', () => new Promise<string>((resolve) => { releaseA = resolve }))
    const resolutionB = b.observe('RESOLVE_CHROMIUM', () => new Promise<string>((resolve) => { releaseB = resolve }))
    expect(events.map((event) => event.resolutionConcurrency)).toEqual([1, 2])
    expect(new Set(events.map((event) => event.runtimeInstanceId)).size).toBe(1)
    expect(a.correlationId).not.toBe(b.correlationId)
    releaseB('/tmp/chromium')
    expect(await resolutionB).toBe('/tmp/chromium')
    const launch = b.observe('LAUNCH', async () => 'browser')
    expect(events.find((event) => event.event === 'PDF_LAUNCH_START')).toMatchObject({ resolutionConcurrency: 1, launchConcurrency: 1 })
    expect(await launch).toBe('browser')
    releaseA('/tmp/chromium')
    await resolutionA
    a.emit('PDF_PAGE_CREATED')
    expect(events.at(-1)).toMatchObject({ resolutionConcurrency: 0, launchConcurrency: 0 })
  })

  it('decrementa contadores em falha e propaga a mesma instância de Error', async () => {
    const events: PdfLogEvent[] = []
    const telemetry = createPdfTelemetry('pdf', (event) => events.push(event))
    const error = Object.assign(new Error('spawn ETXTBSY'), { code: 'ETXTBSY' })
    await expect(telemetry.observe('RESOLVE_CHROMIUM', async () => { throw error })).rejects.toBe(error)
    await expect(telemetry.observe('LAUNCH', async () => { throw error })).rejects.toBe(error)
    telemetry.emit('PDF_PAGE_CREATED')
    expect(events.at(-1)).toMatchObject({ resolutionConcurrency: 0, launchConcurrency: 0 })
    expect(events.filter((event) => event.event.endsWith('_ERROR'))).toHaveLength(2)
    expect(events.filter((event) => event.event.endsWith('_ERROR')).every((event) => event.durationMs! >= 0)).toBe(true)
  })

  it('lê stat sem alterar o executável e registra path mesmo sem error.path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'p151-stat-'))
    const executable = join(root, 'chromium')
    try {
      await writeFile(executable, 'fixture executable')
      const before = await stat(executable)
      const events: PdfLogEvent[] = []
      const telemetry = createPdfTelemetry('termo_cessao', (event) => events.push(event))
      telemetry.setOperationId('510582d8-0000-0000-0000-000000000000')
      vi.stubEnv('CHROMIUM_BINARY_URL', 'https://private-pack.test?token=secret')
      await telemetry.captureExecutable(executable)
      const error = Object.assign(new Error('spawn ETXTBSY'), { code: 'ETXTBSY' })
      await expect(telemetry.observe('LAUNCH', async () => { throw error })).rejects.toBe(error)
      expect(await readFile(executable, 'utf8')).toBe('fixture executable')
      const after = await stat(executable)
      expect([after.size, after.mode, after.mtimeMs]).toEqual([before.size, before.mode, before.mtimeMs])
      expect(events.at(-1)).toMatchObject({
        event: 'PDF_LAUNCH_ERROR', chromiumBinaryUrlConfigured: true,
        operationId: '510582d8-0000-0000-0000-000000000000',
        executableStat: { exists: true, size: before.size, mode: before.mode, mtimeMs: before.mtimeMs, isFile: true },
        error: { path: null, code: 'ETXTBSY' },
      })
      expect(events.at(-1)?.resolvedExecutablePath).toContain('chromium')
      expect(JSON.stringify(events)).not.toContain('private-pack.test')
      await telemetry.captureExecutable(join(root, 'absent'))
      expect(events.at(-1)?.executableStat).toMatchObject({ exists: false, error: { code: 'ENOENT' } })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('não altera resultado ou erro quando o logger falha', async () => {
    const telemetry = createPdfTelemetry('pdf', () => { throw new Error('sink offline') })
    await expect(telemetry.observe('UPLOAD', async () => 42)).resolves.toBe(42)
    const error = new Error('render failed')
    await expect(telemetry.observe('REGISTER', async () => { throw error })).rejects.toBe(error)
  })
})
