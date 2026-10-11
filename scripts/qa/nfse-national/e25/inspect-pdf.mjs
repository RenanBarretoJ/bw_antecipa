// Local text inspection of pinned public PDFs; no model, network, or dispatcher.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
/** @type {(data: Buffer) => Promise<{numpages: number; text: string}>} */
const pdfParse = require('pdf-parse/lib/pdf-parse.js')

const directory = process.argv[2]
if (!directory) throw new Error('PRIVATE_DIRECTORY_REQUIRED')
const samples = JSON.parse(readFileSync(join(directory, 'pdf-samples.json'), 'utf8'))
const rows = []
for (const sample of samples) {
  const bytes = readFileSync(sample.local_private_path)
  if (createHash('sha256').update(bytes).digest('hex') !== sample.sha256) throw new Error('PUBLIC_PDF_HASH_MISMATCH')
  const parsed = await pdfParse(bytes)
  rows.push({ id: sample.id, sha256: sample.sha256, pages: parsed.numpages, text: parsed.text,
    classification: sample.classification, parser: 'pdf-parse/1.1.1', node: process.version })
}
writeFileSync(join(directory, 'pdf-texts.json'), JSON.stringify(rows, null, 2)+'\n', 'utf8')
console.log(JSON.stringify(rows.map(({ id, pages }) => ({ id, pages }))))
