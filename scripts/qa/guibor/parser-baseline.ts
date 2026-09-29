/**
 * Diagnóstico local somente leitura de PDFs. Nunca envia os arquivos a APIs.
 * Uso: npx tsx scripts/qa/guibor/parser-baseline.ts <pdf-A> <pdf-B>
 * Artefatos com dados fiscais ficam exclusivamente em rehearsal/reports (ignorado).
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { extractDanfeFromPdf, extractDanfeFromText, validarDanfeParaPersistencia } from '../../../src/lib/pdf-nf-parser'
import { extractDanfseV2, validateNfseExtraction } from '../../../src/lib/nfse/danfse-v2'

const pdfParse = createRequire(import.meta.url)('pdf-parse') as (buffer: Buffer) => Promise<{ text: string; numpages: number }>

async function main() {
  const inputs = process.argv.slice(2)
  if (inputs.length !== 2) throw new Error('GUIBOR_EXPECTED_TWO_PDF_PATHS')
  const reportPath = 'rehearsal/reports/GUIBOR_PARSER_COMPARISON.json'
  execFileSync('git', ['check-ignore', '--quiet', reportPath], { stdio: 'pipe' })
  const reports = []
  for (const [index, input] of inputs.entries()) {
    const bytes = await readFile(path.resolve(input))
    const label = index === 0 ? 'A' : 'B'
    let native: { text: string; numpages: number } | null = null
    let nativeFailed = false
    const pipeline = await extractDanfeFromPdf(bytes, {
      extractNative: async (buffer) => {
        try { native = await pdfParse(buffer); return native }
        catch (error) { nativeFailed = true; throw error }
      },
      extractAi: async () => { throw new Error('OPENAI_NF_BASELINE_NETWORK_DISABLED') },
    })
    // A atribuição acontece no callback do extrator, não em uma segunda leitura divergente.
    const nativeResult = native as { text: string; numpages: number } | null
    const original = extractDanfeFromText(nativeResult?.text ?? '')
    const nfse = extractDanfseV2(nativeResult?.text ?? '')
    reports.push({
      label, sha256: createHash('sha256').update(bytes).digest('hex'),
      nativeCharacters: nativeResult?.text.length ?? 0, pages: nativeResult?.numpages ?? null,
      nativeFailed, original, originalGate: validarDanfeParaPersistencia(original),
      pipeline, nfse, nfseGate: validateNfseExtraction(nfse),
      remoteVisualExtraction: 'NOT_EXECUTED',
    })
    console.log(JSON.stringify({ label, originalPass: validarDanfeParaPersistencia(original).ok,
      nfsePass: validateNfseExtraction(nfse).ok, dueSource: nfse.vencimento_source,
      strategy: nfse.strategy, visualTest: 'NOT_EXECUTED' }))
  }
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify(reports, null, 2))
}

main().catch(() => { console.error('GUIBOR_BASELINE_FAILED'); process.exitCode = 1 })
