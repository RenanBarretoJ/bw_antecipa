import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import puppeteer from 'puppeteer-core'

// Real SSR components, synthetic props and locally built CSS. Not authenticated app E2E.
assert.deepEqual(process.argv.slice(2), ['--local-only'])
const root = resolve(process.env.LOCALAPPDATA || '/tmp', 'bw-antecipa-evidence')
const output = resolve(process.env.CONCILIACAO_UI_EVIDENCE_DIR || '')
assert(output.startsWith(root + sep), 'LOCAL_SYNTHETIC_EVIDENCE_REQUIRED')
const html = readFileSync(resolve(output, 'components.html'), 'utf8')
const cssRoot = resolve('.next/static/css')
const builtCss = readdirSync(cssRoot).filter(path => path.endsWith('.css')).map(path => readFileSync(resolve(cssRoot, path), 'utf8')).join('\n')
const fontClass = builtCss.match(/\.([_a-zA-Z0-9-]+)\{--font-inter:/)?.[1]
assert(fontClass, 'BUILT_APPLICATION_FONT_REQUIRED')
const css = builtCss.replace(/url\(\/_next\/static\/media\/([^)]*\.woff2)\)/g, (_match, name) => {
  assert(!name.includes('/') && !name.includes('..'), 'LOCAL_FONT_PATH_REQUIRED')
  return `url(data:font/woff2;base64,${readFileSync(resolve('.next/static/media', name)).toString('base64')})`
})
const report = { scope: 'SYNTHETIC_REAL_COMPONENTS_LAYOUT_ONLY', authenticatedE2E: false, remoteRequests: 0, checks: [], passed: false }
const browser = await puppeteer.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [375, 1440]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage()
    await page.setViewport({ width, height: 900 })
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await page.setRequestInterception(true)
    page.on('request', request => { void (request.url().startsWith('data:') ? request.continue() : request.abort()) })
    await page.setContent(html)
    await page.addStyleTag({ content: css })
    await page.evaluate(fontClass => {
      document.documentElement.classList.add(fontClass)
      document.body.classList.add('font-sans', 'antialiased')
    }, fontClass)
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme)
    assert.equal((await page.$$('nav[aria-label="Seções da conciliação"] a')).length, 5)
    assert.equal((await page.$$('nav[aria-label="Visões de Lastro e Logística"] a')).length, 2)
    const bounds = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }))
    assert(bounds.content <= bounds.viewport, 'HORIZONTAL_OVERFLOW')
    for (const link of await page.$$('nav a')) {
      const box = await link.boundingBox()
      assert(box && box.height >= 44, 'NAVIGATION_TARGET_TOO_SMALL')
    }
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'A')
    await page.screenshot({ path: resolve(output, `${width}-${theme}.png`), fullPage: true })
    report.checks.push({ width, theme, noHorizontalOverflow: true, keyboardFocus: true, primaryLinks: 5, secondaryLinks: 2, targetsAtLeast44px: true })
    await page.close()
  }
  report.passed = true
} finally {
  await browser.close()
  writeFileSync(resolve(output, 'BROWSER_REPORT.json'), JSON.stringify(report, null, 2))
}
console.log(JSON.stringify({ output, ...report }))
