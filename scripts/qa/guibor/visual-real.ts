/** Real parser certification; no database writes. PDFs and detailed reports stay ignored. */
import { loadEnvFile } from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { probeNfsePdf } from '../../../src/lib/nfse/pdf-dispatcher.server'
import { validateNfseExtraction } from '../../../src/lib/nfse/danfse-v2'

async function main() {
  const [envFile, pdfA, pdfB] = process.argv.slice(2)
  if (!envFile || !pdfA || !pdfB) throw new Error('GUIBOR_ARGS_REQUIRED')
  loadEnvFile(envFile)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!url.includes('fhgkmggthxikfpogrvaa.supabase.co')) throw new Error('GUIBOR_HOMOLOG_ENV_REQUIRED')
  const report = 'rehearsal/reports/GUIBOR_A3_REAL_VISUAL.json'
  execFileSync('git', ['check-ignore', '--quiet', report])
  const results = []
  for (const [index, pdf] of [pdfA, pdfB].entries()) {
    const bytes = await readFile(pdf)
    const result = await probeNfsePdf(bytes)
    const expected = index === 0
      ? { numero_nf: '49', valor_bruto: 39521.98, valor_liquido: 37229.70, data_emissao: '2026-09-14', competencia: '2026-09-09' }
      : { numero_nf: '232', valor_bruto: 112710.81, valor_liquido: 105779.10, data_emissao: '2026-09-15', competencia: '2026-09-15' }
    const pass = result && validateNfseExtraction(result).ok && result.vencimento_source === 'MISSING'
      && !result.dados.data_vencimento && Object.entries(expected).every(([key, value]) => result.dados[key as keyof typeof result.dados] === value)
      && result.strategy === (index === 0 ? 'danfse_v2_labels' : 'danfse_v2_visual')
    results.push({ label: index === 0 ? 'A' : 'B', pass: Boolean(pass), sha256: createHash('sha256').update(bytes).digest('hex'), result })
    console.log(JSON.stringify({ label: index === 0 ? 'A' : 'B', pass: Boolean(pass), strategy: result?.strategy, dueSource: result?.vencimento_source }))
  }
  await writeFile(report, JSON.stringify({ at: new Date().toISOString(), results }, null, 2))
  if (results.some(row => !row.pass)) throw new Error('GUIBOR_REAL_PIPELINE_FAIL')
}
main().catch(error => {
  console.error(error instanceof Error && /^(NFSE_VISUAL|GUIBOR)_[A-Z_]+$/.test(error.message) ? error.message : 'GUIBOR_CERTIFICATION_FAILED')
  process.exitCode = 1
})
