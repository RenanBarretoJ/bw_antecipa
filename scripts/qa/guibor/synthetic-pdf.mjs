import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { danfseFixture } from '../../../src/lib/nfse/fixtures/danfse-v2.ts'

/** Local QA only. Never a fiscal document; does not authenticate or upload anything. */
export async function createSyntheticNfsePdf(page, { variant, issuer, outputPath }) {
  assert(['A', 'B'].includes(variant))
  assert(/^\d{14}$/.test(issuer))
  assert(!existsSync(outputPath), 'DO_NOT_OVERWRITE_QA_EVIDENCE')
  const text = danfseFixture(variant).replace('11.222.333/0001-81', issuer)
    .replace('1234567890'.repeat(5), variant === 'A' ? '1234567890'.repeat(5) : '2468013579'.repeat(5))
  // OS/browser dark mode must never produce black text on a dark paper image.
  const paper = ':root{color-scheme:only light}html,body,pre{background:#fff;color:#000}'
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.setViewport({ width: 900, height: 1500, deviceScaleFactor: 2 })
  await page.setContent(`<html><meta charset="utf-8"><style>${paper}pre{font-size:8px;line-height:10px;white-space:pre-wrap}</style><pre>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</pre></html>`)
  let contrast
  if (variant === 'B') {
    await page.addStyleTag({ content: 'pre{font-size:12px;line-height:16px}' })
    const pixels = await (await page.$('pre')).screenshot({ encoding: 'base64' })
    contrast = await page.evaluate(async base64 => {
      const image = new Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0)
      const { data } = context.getImageData(0, 0, image.width, image.height)
      let white = 0, black = 0, transparent = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) white++
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) black++
        if (data[i + 3] !== 255) transparent++
      }
      const total = image.width * image.height
      return { whiteRatio: white / total, blackRatio: black / total, transparent }
    }, pixels)
    assert(contrast.whiteRatio > 0.8 && contrast.blackRatio > 0.001 && contrast.transparent === 0, 'QA_RASTER_LOW_CONTRAST')
    await page.setContent(`<html><style>${paper}@page{margin:0}body{margin:0}img{width:100%;height:auto}</style><img src="data:image/png;base64,${pixels}"></html>`)
    await page.waitForFunction(() => document.querySelector('img')?.complete)
  }
  await page.pdf({ path: outputPath, format: 'A4', margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } })
  const bytes = readFileSync(outputPath)
  assert(bytes.length > 1000)
  // Isolate pdf-parse's CommonJS loader from browser/ESM initialization.
  const parsed = spawnSync(process.execPath, ['-e', "require('pdf-parse')(require('fs').readFileSync(process.argv[1])).then(r=>console.log(JSON.stringify({pages:r.numpages,text:r.text}))).catch(()=>process.exitCode=1)", outputPath],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 })
  assert.equal(parsed.status, 0, 'QA_PDF_PARSE_FAILED')
  const native = JSON.parse(parsed.stdout)
  assert.equal(native.pages, 1, 'QA_EXPECTS_ONE_PAGE')
  assert(variant === 'A' ? native.text.includes('DANFSe v2.0') : native.text.trim().length === 0, 'QA_PDF_MODALITY_MISMATCH')
  return { variant, bytes: bytes.length, pages: native.pages, nativeChars: native.text.trim().length,
    sha256: createHash('sha256').update(bytes).digest('hex'), ...(contrast ? { contrast } : {}) }
}
