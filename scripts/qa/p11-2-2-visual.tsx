/** Synthetic, read-only browser check for the P11.2.2 responsive parcel view. Run after next build. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import puppeteer from 'puppeteer-core'
import { OperacaoParcelaCedidaRow, PARCELA_CEDIDA_COLUNAS, type ParcelaCedidaOperacao } from '@/components/operacoes/OperacaoParcelaCedidaRow'
import { buildOperacaoNotaFiscalView, OperacaoNotaFiscalCard } from '@/components/operacoes/OperacaoNotaFiscalCard'

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? cssFiles(path) : entry.name.endsWith('.css') ? [path] : []
  })
}

const css = cssFiles(join(process.cwd(), '.next', 'static')).map((file) => readFileSync(file, 'utf8')).join('\n')
if (!css.includes('md\\:sr-only')) throw new Error('CSS compilado das parcelas não encontrado; execute o build antes do teste visual.')

const parcelas: ParcelaCedidaOperacao[] = [
  { parcelaId: 'a', numeroParcela: 1, dataVencimento: '2026-10-10', valorNominal: 10000, diasAplicados: 30, valorPresente: 9500, desconto: 500 },
  { parcelaId: 'b', numeroParcela: 2, dataVencimento: '2026-11-10', valorNominal: 8000, diasAplicados: 45, valorPresente: 7200, desconto: 800 },
]
const nota = buildOperacaoNotaFiscalView({
  notaFiscal: { id: 'qa-nf', numero_nf: '1741', cnpj_destinatario: '40439661000132', razao_social_destinatario: 'Sacado QA', valor_bruto: 10000, data_vencimento: '2026-10-10', status: 'em_antecipacao' },
  valorAntecipado: 9500,
  nowMs: new Date('2026-09-15T12:00:00Z').getTime(),
})
const header = `<div aria-hidden="true" class="hidden grid-cols-[3.5rem_6rem_7rem_5rem_7rem_7rem] gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground md:grid">${PARCELA_CEDIDA_COLUNAS.map((label) => `<span>${label}</span>`).join('')}</div>`
const rows = renderToStaticMarkup(createElement(Fragment, null, ...parcelas.map((parcela) => createElement(OperacaoParcelaCedidaRow, { key: parcela.parcelaId, parcela }))))
const states = ['solicitada', 'em_analise', 'aprovada', 'em_andamento', 'liquidada', 'inadimplente', 'reprovada', 'cancelada']
const stateCards = states.map((status) => `<section data-status="${status}" class="mt-4 grid gap-2"><h2>${status}</h2>${renderToStaticMarkup(createElement(OperacaoNotaFiscalCard, { notaFiscal: nota, statusNode: status, href: '/gestor/notas-fiscais/qa-nf' }))}<div data-parcelas="true">${header}${rows}</div>${renderToStaticMarkup(createElement(OperacaoNotaFiscalCard, { notaFiscal: nota, memoriaLegada: { dias_aplicados: 30, valor_nominal: 10000, desconto: 500, valor_presente: 9500 }, statusNode: status, href: '/gestor/notas-fiscais/qa-nf' }))}</section>`).join('')
const html = `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body class="bg-background text-foreground"><main id="fixture" class="mx-auto max-w-5xl p-4"><h1>P11.2.2 QA visual sintético</h1><div id="parcelas" class="mt-4 divide-y divide-border rounded-lg border"><button type="button" aria-expanded="true" class="w-full p-2 text-left focus-visible:ring-2 focus-visible:ring-ring">2/2 parcelas cedidas</button>${header}${rows}</div>${stateCards}</main></body></html>`

async function main() {
  const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
  for (const width of [390, 430, 820, 1440]) {
    const page = await browser.newPage()
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 })
    await page.setContent(html, { waitUntil: 'load' })
    await page.keyboard.press('Tab')
    const result = await page.evaluate(() => {
      const root = document.querySelector('#parcelas')!
      const row = root.querySelector('dl')!
      const header = root.querySelector('[aria-hidden="true"]')!
      const labels = Array.from(row.querySelectorAll('dt'))
      const stateSections = Array.from(document.querySelectorAll('section[data-status]'))
      return {
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        parcelOverflow: root.scrollWidth > root.clientWidth,
        columns: getComputedStyle(row).gridTemplateColumns,
        headerVisible: getComputedStyle(header).display !== 'none',
        visibleLabels: labels.filter((label) => {
          const rect = label.getBoundingClientRect()
          return rect.width > 2 && rect.height > 2
        }).length,
        accessibleLabels: labels.map((label) => label.textContent),
        rows: root.querySelectorAll('dl').length,
        stateCards: stateSections.length,
        stateParcelRows: stateSections.filter((section) => section.querySelectorAll('[data-parcelas="true"] dl').length === 2).length,
        legacyCards: stateSections.filter((section) => section.querySelector('[aria-label="Memória congelada da NF"]')).length,
        redundantMemory: document.body.textContent?.includes('Ver memoria de calculo por NF') || false,
        keyboardFocus: document.activeElement?.textContent?.includes('parcelas cedidas') || false,
      }
    })
    const mobile = width < 768
    if (result.horizontalOverflow || result.parcelOverflow || result.headerVisible === mobile || result.visibleLabels !== (mobile ? 6 : 0) || result.rows !== 2 || result.stateCards !== states.length || result.stateParcelRows !== states.length || result.legacyCards !== states.length || result.redundantMemory || !result.keyboardFocus) {
      throw new Error(`${width}px: ${JSON.stringify(result)}`)
    }
    if (process.env.P11_2_2_SCREENSHOT_DIR && (width === 390 || width === 820)) {
      await (await page.$('#parcelas'))!.screenshot({ path: join(process.env.P11_2_2_SCREENSHOT_DIR, `p11-2-2-${width}.png`) })
    }
    process.stdout.write(`${width}px PASS ${JSON.stringify(result)}\n`)
    await page.close()
  }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
