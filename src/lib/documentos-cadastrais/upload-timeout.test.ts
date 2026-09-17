import { describe, expect, it, vi } from 'vitest'
import { aguardarUploadComPrazo, UploadTimeoutError } from './upload-timeout'

describe('P9.0 timeout do upload', () => {
  it('retorna o resultado e limpa o timer', async () => {
    expect(await aguardarUploadComPrazo(Promise.resolve('ok'), 1000)).toBe('ok')
  })

  it('libera o fluxo quando uma chamada nao responde', async () => {
    vi.useFakeTimers()
    try {
      const pending = aguardarUploadComPrazo(new Promise<never>(() => {}), 100)
      const assertion = expect(pending).rejects.toThrow('UPLOAD_TIMEOUT')
      await vi.advanceTimersByTimeAsync(100)
      await assertion
    } finally { vi.useRealTimers() }
  })

  it('classifica o prazo por fase sem confundir com erro de rede', async () => {
    vi.useFakeTimers()
    try {
      const pending = aguardarUploadComPrazo(new Promise<never>(() => {}), 100, 'FINALIZE')
      const assertion = expect(pending).rejects.toMatchObject({ name: 'UploadTimeoutError', phase: 'FINALIZE' })
      await vi.advanceTimersByTimeAsync(100)
      await assertion
      expect(new UploadTimeoutError('PREPARE').phase).toBe('PREPARE')
    } finally { vi.useRealTimers() }
  })
})
