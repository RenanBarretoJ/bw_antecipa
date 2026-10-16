import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolverExecutavelChromium } from './chromium-executable'

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock('@sparticuz/chromium', () => ({ default: { executablePath: mocks.resolve } }))
const clearPreparation = () => Reflect.deleteProperty(globalThis, Symbol.for('bw-antecipa.pdf.chromium-preparation.v1'))
beforeEach(() => {
  clearPreparation()
  vi.resetAllMocks()
  vi.stubEnv('CHROMIUM_BINARY_URL', '')
})
afterEach(() => { clearPreparation(); vi.unstubAllEnvs() })

describe('preparação compartilhada do executável Chromium', () => {
  it('faz todas as chamadas concorrentes aguardarem a mesma extração até o fechamento', async () => {
    let finish!: (path: string) => void
    mocks.resolve.mockImplementation(() => new Promise<string>(resolve => { finish = resolve }))
    const first = resolverExecutavelChromium()
    const second = resolverExecutavelChromium()
    expect(first).toBe(second)
    await Promise.resolve()
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith()
    let returned = false
    void second.then(() => { returned = true })
    await Promise.resolve()
    expect(returned).toBe(false)
    finish('/tmp/chromium')
    expect(await Promise.all([first, second])).toEqual(['/tmp/chromium', '/tmp/chromium'])
    expect(await resolverExecutavelChromium()).toBe('/tmp/chromium')
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
  })

  it('compartilha a preparação mesmo com outra cópia do módulo em um bundle de rota', async () => {
    mocks.resolve.mockResolvedValue('/tmp/chromium')
    const first = resolverExecutavelChromium()
    vi.resetModules()
    const duplicate = await import('./chromium-executable')
    expect(duplicate.resolverExecutavelChromium()).toBe(first)
    expect(await first).toBe('/tmp/chromium')
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
  })

  it('preserva o erro original e não tenta usar ou extrair novamente um arquivo parcial', async () => {
    const error = Object.assign(new Error('EIO'), { code: 'EIO', path: '/tmp/chromium' })
    mocks.resolve.mockRejectedValue(error)
    await expect(resolverExecutavelChromium()).rejects.toBe(error)
    await expect(resolverExecutavelChromium()).rejects.toBe(error)
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
  })

  it('preserva a fonte configurada e recusa trocá-la dentro de um runtime já iniciado', async () => {
    vi.stubEnv('CHROMIUM_BINARY_URL', 'https://qa.example.invalid/pack.tar')
    mocks.resolve.mockResolvedValue('/tmp/chromium')
    await resolverExecutavelChromium()
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith('https://qa.example.invalid/pack.tar')
    vi.stubEnv('CHROMIUM_BINARY_URL', 'https://qa.example.invalid/other.tar')
    await expect(resolverExecutavelChromium()).rejects.toThrow('configuration changed')
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
  })
})
