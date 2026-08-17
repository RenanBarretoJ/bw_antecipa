import { describe, expect, it } from 'vitest'
import { htmlParaPdf } from './gerarContrato'

const chromePath = process.env.CHROME_PATH
const describeRuntime = chromePath ? describe : describe.skip

describeRuntime('runtime de PDF com Chromium real', () => {
  for (const documento of ['contrato', 'termo de cessao', 'termo de quitacao']) {
    it(`gera ${documento} sintetico com conteudo nao vazio`, async () => {
      const pdf = await htmlParaPdf(`<!doctype html><html><body><h1>${documento}</h1><p>BW Antecipa</p></body></html>`)

      expect(pdf.byteLength).toBeGreaterThan(100)
      expect(pdf.subarray(0, 4).toString('ascii')).toBe('%PDF')
    }, 30_000)
  }
})
