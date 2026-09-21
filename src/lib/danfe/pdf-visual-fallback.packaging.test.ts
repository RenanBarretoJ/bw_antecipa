import { describe, expect, it } from 'vitest'
import nextConfig from '../../../next.config'

describe('empacotamento do fallback visual de PDF', () => {
  it('inclui no tracing todos os assets carregados dinamicamente no runtime', () => {
    const includes = nextConfig.outputFileTracingIncludes?.['/*'] || []

    expect(includes).toEqual(expect.arrayContaining([
      './node_modules/@tesseract.js-data/por/**/*',
      './node_modules/tesseract.js-core/**/*',
      './node_modules/pdfjs-dist/standard_fonts/**/*',
      './node_modules/zxing-wasm/dist/reader/*.wasm',
    ]))
  })
})
