import { describe, expect, it, vi } from 'vitest'
import { readNativePdfText } from './native-text.server'
import { probeNfsePdf } from '../nfse/pdf-dispatcher.server'
import { danfseFixture } from '../nfse/fixtures/danfse-v2'

describe('shared bounded native PDF read', () => {
  it('recovers a transient native read without using visual classification', async () => {
    const native = vi.fn().mockRejectedValueOnce(new Error('bad XRef entry'))
      .mockResolvedValue({ text: danfseFixture() })
    const classify = vi.fn()
    const result = await probeNfsePdf(Buffer.from('synthetic QA'), { native, classify })
    expect(result?.tipo_documento).toBe('NFSE')
    expect(native).toHaveBeenCalledTimes(2)
    expect(classify).not.toHaveBeenCalled()
  })

  it('bounds persistent failure and never gives the reader the owned original buffer', async () => {
    const bytes = Buffer.from('original')
    const failure = new Error('native unavailable')
    const reader = vi.fn(async (copy: Buffer) => {
      expect(copy).not.toBe(bytes)
      copy.fill(0)
      throw failure
    })
    await expect(readNativePdfText(bytes, reader)).rejects.toBe(failure)
    expect(reader).toHaveBeenCalledTimes(3)
    expect(bytes.toString()).toBe('original')
  })
})
