import 'server-only'

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import porData from '@tesseract.js-data/por'
import { pdf } from 'pdf-to-img'
import sharp from 'sharp'
import { createWorker, OEM, PSM } from 'tesseract.js'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'

export const VISUAL_PDF_LIMITS = Object.freeze({
  maxPages: 2,
  maxRenderedPixels: 5_000_000,
  renderScale: 3,
  maxConcurrent: 2,
  timeoutMs: 50_000,
})
const TOP_REGION_RATIO = 0.46
const TOP_HORIZONTAL_STRETCH = 1.6

export type VisualFallbackReason = 'NO_TEXT_LAYER' | 'TEXT_INSUFFICIENT' | 'MISSING_CORE_ANCHORS' | 'NATIVE_EXTRACTION_FAILED'

export type VisualPdfExtraction = {
  text: string
  accessKey?: string
  ocrConfidence: number
  durationMs: number
  pageCount: number
  fallbackTriggerReason: VisualFallbackReason
}

export class VisualPdfExtractionError extends Error {
  constructor(
    public readonly code:
      | 'VISUAL_PDF_TOO_MANY_PAGES'
      | 'VISUAL_PDF_TOO_MANY_PIXELS'
      | 'VISUAL_PDF_RENDER_FAILED'
      | 'VISUAL_PDF_OCR_FAILED'
      | 'VISUAL_PDF_TIMEOUT',
  ) {
    super(code)
    this.name = 'VisualPdfExtractionError'
  }
}

let activeFallbacks = 0
const fallbackWaiters: Array<() => void> = []
let zxingPrepared = false

async function acquireFallbackSlot(): Promise<() => void> {
  if (activeFallbacks >= VISUAL_PDF_LIMITS.maxConcurrent) {
    await new Promise<void>((resolve) => fallbackWaiters.push(resolve))
  }
  activeFallbacks += 1
  let released = false
  return () => {
    if (released) return
    released = true
    activeFallbacks -= 1
    fallbackWaiters.shift()?.()
  }
}

function localPdfJsFontsUrl(): string {
  const packageJson = require.resolve('pdfjs-dist/package.json')
  return `${pathToFileURL(path.join(path.dirname(packageJson), 'standard_fonts')).href}/`
}

function prepareLocalBarcodeReader(): void {
  if (zxingPrepared) return
  const readerEntry = require.resolve('zxing-wasm/reader')
  const wasmPath = path.resolve(path.dirname(readerEntry), '..', '..', 'reader', 'zxing_reader.wasm')
  const wasm = readFileSync(wasmPath)
  const wasmBinary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)
  prepareZXingModule({ overrides: { wasmBinary } })
  zxingPrepared = true
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new VisualPdfExtractionError('VISUAL_PDF_TIMEOUT')), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new VisualPdfExtractionError('VISUAL_PDF_TIMEOUT')
  return remaining
}

async function withinDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  return withTimeout(promise, remainingTime(deadline))
}

function comparableText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
}

function isValidCnpj(value: string): boolean {
  if (!/^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false
  const digit = (length: 12 | 13) => {
    let sum = 0
    let weight = length - 7
    for (let index = 0; index < length; index += 1) {
      sum += Number(value[index]) * weight
      weight -= 1
      if (weight < 2) weight = 9
    }
    const remainder = sum % 11
    return remainder < 2 ? 0 : 11 - remainder
  }
  return Number(value[12]) === digit(12) && Number(value[13]) === digit(13)
}

function formatBrDate(day: number, month: number, year: number): string | undefined {
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return undefined
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
}

function plausibleDueDate(date: string, issueDate?: string): boolean {
  if (!issueDate) return true
  const issue = new Date(`${issueDate.split('/').reverse().join('-')}T00:00:00Z`)
  const due = new Date(`${date.split('/').reverse().join('-')}T00:00:00Z`)
  const maxDue = new Date(issue)
  maxDue.setUTCFullYear(maxDue.getUTCFullYear() + 3)
  return due >= issue && due <= maxDue
}

function recoverIssueDate(text: string, accessKey?: string): string | undefined {
  if (!accessKey || !/^\d{44}$/.test(accessKey)) return undefined
  const expectedYear = 2000 + Number(accessKey.slice(2, 4))
  const expectedMonth = Number(accessKey.slice(4, 6))
  const comparable = comparableText(text)
  const candidates: Array<{ value: string; anchored: boolean }> = []
  for (const match of text.matchAll(/\b(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{4})\b/g)) {
    const day = Number(match[1])
    const month = Number(match[2])
    const year = Number(match[3])
    const date = formatBrDate(day, month, year)
    if (date && year === expectedYear && month === expectedMonth) {
      const before = comparable.slice(Math.max(0, (match.index || 0) - 80), match.index)
      candidates.push({ value: date, anchored: /EMISS(?:AO|ÃO)|DATA\s+(?:DA\s+)?EMISSAO/.test(before) })
    }
  }
  const scores = new Map<string, number>()
  for (const candidate of candidates) {
    scores.set(candidate.value, (scores.get(candidate.value) || 0) + (candidate.anchored ? 2 : 1))
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

function recoverDueDate(text: string, issueDate?: string): string | undefined {
  const issueIso = issueDate ? issueDate.split('/').reverse().join('-') : undefined
  const anchors = [...comparableText(text).matchAll(/V?\s*E\s*N\s*C\s*I\s*M\s*E\s*N\s*T\s*O\s*:?/g)]
  for (const anchor of anchors) {
    const block = text.slice((anchor.index || 0) + anchor[0].length, (anchor.index || 0) + anchor[0].length + 80)
    const lines = block.split(/\r?\n/).slice(0, 4)
    for (const line of lines) {
      const exact = line.match(/(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{4})/)
      const digits = exact ? `${exact[1]}${exact[2]}${exact[3]}` : line.replace(/\D/g, '').slice(0, 8)
      if (digits.length !== 8) continue
      const date = formatBrDate(Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), Number(digits.slice(4)))
      if (!date) continue
      const iso = date.split('/').reverse().join('-')
      if ((!issueIso || iso >= issueIso) && plausibleDueDate(date, issueDate)) return date
    }
  }
  return undefined
}

function recoverDestinationCnpj(text: string, issuerCnpj?: string): string | undefined {
  const comparable = comparableText(text)
  const destinationIndexes = [...comparable.matchAll(/DESTINATARIO/g)].map((match) => match.index)
  const candidates = destinationIndexes.flatMap((destinationIndex) => {
    const block = text.slice(destinationIndex, destinationIndex + 2_500)
    return [...block.matchAll(/\b(\d{2}\s*\.\s*\d{3}\s*\.\s*\d{3}\s*\/\s*\d{4}\s*-\s*\d{2})\b/g)]
      .map((match) => match[1].replace(/\D/g, ''))
      .filter((value) => value !== issuerCnpj && isValidCnpj(value))
  })
  const unique = [...new Set(candidates)]
  return unique.length === 1 ? unique[0] : undefined
}

type OcrWord = { line: string; left: number; top: number; width: number; height: number; text: string }

function parseTsvWords(tsv?: string | null): OcrWord[] {
  if (!tsv) return []
  return tsv.split('\n').slice(1).flatMap((row) => {
    const cells = row.split('\t')
    if (cells.length < 12 || cells[0] !== '5' || !cells[11]) return []
    return [{
      line: `${cells[2]}.${cells[3]}.${cells[4]}`,
      left: Number(cells[6]),
      top: Number(cells[7]),
      width: Number(cells[8]),
      height: Number(cells[9]),
      text: cells.slice(11).join('\t'),
    }]
  })
}

function normalizeVisualMoney(parts: string[]): string | undefined {
  const joined = parts.join('').replace(/[|!lI]/g, '1').replace(/[^\d.,]/g, '')
  return /^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(joined) ? joined : undefined
}

function datesFromVisualParts(parts: string[], issueDate?: string): string[] {
  const joined = parts.join(' ')
  const candidates = new Set<string>()
  for (const match of joined.matchAll(/(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{4})/g)) {
    const date = formatBrDate(Number(match[1]), Number(match[2]), Number(match[3]))
    if (date) candidates.add(date)
  }
  const digits = joined.replace(/\D/g, '')
  for (let index = 0; index <= digits.length - 8; index += 1) {
    const value = digits.slice(index, index + 8)
    const date = formatBrDate(Number(value.slice(0, 2)), Number(value.slice(2, 4)), Number(value.slice(4)))
    if (date) candidates.add(date)
  }
  const issueIso = issueDate?.split('/').reverse().join('-')
  return [...candidates].filter((date) => {
    const iso = date.split('/').reverse().join('-')
    return (!issueIso || iso >= issueIso) && plausibleDueDate(date, issueDate)
  })
}

export function recoverDueDateFromTsv(tsv?: string | null, issueDate?: string): string | undefined {
  const words = parseTsvWords(tsv)
  const lines = new Map<string, OcrWord[]>()
  for (const word of words) lines.set(word.line, [...(lines.get(word.line) || []), word])
  const found: string[] = []
  for (const labelWords of lines.values()) {
    labelWords.sort((a, b) => a.left - b.left)
    const labelText = comparableText(labelWords.map((word) => word.text).join('')).replace(/\W/g, '')
    if (!labelText.includes('VENCIMENTO')) continue
    const sameLineDates = datesFromVisualParts(labelWords.map((word) => word.text), issueDate)
    if (sameLineDates.length > 0) return sameLineDates.sort((a, b) => b.localeCompare(a))[0]
    const labelLeft = Math.min(...labelWords.map((word) => word.left))
    const labelTop = Math.min(...labelWords.map((word) => word.top))
    const labelHeight = Math.max(...labelWords.map((word) => word.height))
    const following = [...lines.values()]
      .filter((lineWords) => {
        const top = Math.min(...lineWords.map((word) => word.top))
        return top > labelTop + labelHeight && top <= labelTop + Math.max(120, labelHeight * 8)
      })
      .map((lineWords) => lineWords.filter((word) => word.left >= labelLeft - 20))
      .filter((lineWords) => lineWords.length > 0)
      .sort((a, b) => Math.min(...a.map((word) => word.top)) - Math.min(...b.map((word) => word.top)))
    for (const lineWords of following.slice(0, 3)) {
      lineWords.sort((a, b) => a.left - b.left)
      found.push(...datesFromVisualParts(lineWords.map((word) => word.text), issueDate))
    }
  }
  const counts = new Map<string, number>()
  for (const value of found) counts.set(value, (counts.get(value) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0]
}

function anchorRegionFromTsv(
  tsv: string | null | undefined,
  anchor: string,
  imageWidth: number,
  imageHeight: number,
): { left: number; top: number; width: number; height: number } | undefined {
  const words = parseTsvWords(tsv)
  const lines = new Map<string, OcrWord[]>()
  for (const word of words) lines.set(word.line, [...(lines.get(word.line) || []), word])
  for (const lineWords of lines.values()) {
    const structural = comparableText(lineWords.map((word) => word.text).join('')).replace(/\W/g, '')
    if (!structural.includes(anchor)) continue
    const maxRight = Math.max(...lineWords.map((word) => word.left + word.width))
    const minTop = Math.min(...lineWords.map((word) => word.top))
    const left = Math.max(0, maxRight - 15)
    const top = Math.max(0, minTop - 5)
    return {
      left,
      top,
      width: Math.min(imageWidth - left, Math.max(420, Math.floor(imageWidth * 0.25))),
      height: Math.min(imageHeight - top, 35),
    }
  }
  return undefined
}

export function recoverCanonicalTotalFromTsv(tsv?: string | null): string | undefined {
  const words = parseTsvWords(tsv)
  const lines = new Map<string, OcrWord[]>()
  for (const word of words) lines.set(word.line, [...(lines.get(word.line) || []), word])
  for (const labelWords of lines.values()) {
    labelWords.sort((a, b) => a.left - b.left)
    if (!/VALORTOTALDANOTA/.test(comparableText(labelWords.map((word) => word.text).join('')).replace(/\W/g, ''))) continue
    const labelLeft = Math.min(...labelWords.map((word) => word.left))
    const labelTop = Math.min(...labelWords.map((word) => word.top))
    const labelHeight = Math.max(...labelWords.map((word) => word.height))
    const candidateLines = [...lines.values()]
      .map((lineWords) => lineWords.filter((word) => word.left >= labelLeft - 20))
      .filter((lineWords) => lineWords.length > 0)
      .filter((lineWords) => {
        const top = Math.min(...lineWords.map((word) => word.top))
        return top > labelTop + labelHeight && top <= labelTop + Math.max(90, labelHeight * 6)
      })
      .sort((a, b) => Math.min(...a.map((word) => word.top)) - Math.min(...b.map((word) => word.top)))
    for (const lineWords of candidateLines) {
      lineWords.sort((a, b) => a.left - b.left)
      const value = normalizeVisualMoney(lineWords.map((word) => word.text))
      if (value) return value
    }
  }
  return undefined
}

function recoverReceiptTotals(text: string): Set<string> {
  const values = new Set<string>()
  const pattern = /V\s*A\s*L\s*O\s*R\s+T\s*O\s*T\s*A\s*L\s*:?\s*R\$\s*([|!lI\d][\d\s.,|!lI\]]{2,30})/gi
  for (const match of text.matchAll(pattern)) {
    const value = normalizeVisualMoney([match[1]])
    if (value) values.add(value)
  }
  return values
}

function corroboratedCanonicalTotal(
  rawTsv?: string | null,
  enrichedTsv?: string | null,
  combinedText = '',
  normalizedTsv?: string | null,
): string | undefined {
  const raw = recoverCanonicalTotalFromTsv(rawTsv)
  const enriched = recoverCanonicalTotalFromTsv(enrichedTsv)
  if (raw && enriched && raw === enriched) return raw
  const receiptTotals = recoverReceiptTotals(combinedText)
  if (raw && receiptTotals.has(raw)) return raw
  if (enriched && receiptTotals.has(enriched)) return enriched
  const normalized = recoverCanonicalTotalFromTsv(normalizedTsv)
  const candidates = [raw, enriched, normalized].filter((value): value is string => Boolean(value))
  return candidates.find((candidate) => candidates.filter((value) => value === candidate).length >= 2)
}

export function composeVisualDanfeText(input: {
  rawText: string
  enrichedText?: string
  accessKey?: string
  canonicalTotal?: string
  dueDate?: string
}): string {
  const combined = [input.rawText, input.enrichedText].filter(Boolean).join('\n')
  const issuerCnpj = input.accessKey?.match(/^\d{6}(\d{14})/)?.[1]
  const issueDate = recoverIssueDate(combined, input.accessKey)
  const dueDate = input.dueDate || recoverDueDate(combined, issueDate)
  const destinationCnpj = recoverDestinationCnpj(combined, issuerCnpj)
  const prefix = [
    input.accessKey ? `CHAVE DE ACESSO ${input.accessKey}` : undefined,
    issuerCnpj ? `IDENTIFICACAO DO EMITENTE\nCNPJ ${issuerCnpj}\nDESTINATARIO / REMETENTE` : undefined,
    destinationCnpj ? `CNPJ ${destinationCnpj}` : undefined,
    issueDate ? `DATA DE EMISSAO ${issueDate}` : undefined,
    dueDate ? `VENCIMENTO ${dueDate}` : undefined,
    input.canonicalTotal ? `VALOR TOTAL DA NOTA R$ ${input.canonicalTotal}` : undefined,
  ].filter(Boolean)
  return [...prefix, combined].join('\n')
}

async function readAccessKey(image: Buffer): Promise<string | undefined> {
  prepareLocalBarcodeReader()
  const results = await readBarcodes(image, {
    formats: ['Code128'],
    maxNumberOfSymbols: 4,
    tryHarder: true,
  })
  const candidates = results.map((result) => result.text).filter((value) => /^\d{44}$/.test(value))
  return [...new Set(candidates)].length === 1 ? candidates[0] : undefined
}

async function extractVisualText(buffer: Buffer, fallbackTriggerReason: VisualFallbackReason): Promise<VisualPdfExtraction> {
  const started = performance.now()
  const deadline = Date.now() + VISUAL_PDF_LIMITS.timeoutMs
  let document: Awaited<ReturnType<typeof pdf>> | undefined
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined
  try {
    const documentPromise = pdf(buffer, {
      scale: VISUAL_PDF_LIMITS.renderScale,
      docInitParams: {
        standardFontDataUrl: localPdfJsFontsUrl(),
        useSystemFonts: true,
      },
    })
    try {
      document = await withinDeadline(documentPromise, deadline)
    } catch (error) {
      void documentPromise.then((lateDocument) => lateDocument.destroy()).catch(() => undefined)
      if (error instanceof VisualPdfExtractionError) throw error
      throw new VisualPdfExtractionError('VISUAL_PDF_RENDER_FAILED')
    }
    if (document.length < 1 || document.length > VISUAL_PDF_LIMITS.maxPages) {
      throw new VisualPdfExtractionError('VISUAL_PDF_TOO_MANY_PAGES')
    }
    const image = await withinDeadline(document.getPage(1), deadline).catch((error) => {
      if (error instanceof VisualPdfExtractionError) throw error
      throw new VisualPdfExtractionError('VISUAL_PDF_RENDER_FAILED')
    })
    const metadata = await withinDeadline(sharp(image).metadata(), deadline)
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > VISUAL_PDF_LIMITS.maxRenderedPixels) {
      throw new VisualPdfExtractionError('VISUAL_PDF_TOO_MANY_PIXELS')
    }

    const accessKeyPromise = withinDeadline(readAccessKey(image), deadline)
    const workerPromise = createWorker('por', OEM.LSTM_ONLY, {
      langPath: porData.langPath,
      gzip: porData.gzip,
      cacheMethod: 'readOnly',
    })
    try {
      worker = await withinDeadline(workerPromise, deadline)
    } catch (error) {
      void workerPromise.then((lateWorker) => lateWorker.terminate()).catch(() => undefined)
      throw error
    }
    await withinDeadline(worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
    }), deadline)
    const raw = await withinDeadline(worker.recognize(image, {}, { text: true, tsv: true }), deadline).catch((error) => {
      if (error instanceof VisualPdfExtractionError) throw error
      throw new VisualPdfExtractionError('VISUAL_PDF_OCR_FAILED')
    })
    const accessKey = await accessKeyPromise

    const topHeight = Math.floor(metadata.height * TOP_REGION_RATIO)
    const topRegion = await withinDeadline(sharp(image)
      .extract({ left: 0, top: 0, width: metadata.width, height: topHeight })
      .resize({ width: Math.floor(metadata.width * TOP_HORIZONTAL_STRETCH), height: topHeight, fit: 'fill' })
      .grayscale()
      .normalize()
      .png()
      .toBuffer(), deadline)
    const enriched = await withinDeadline(worker.recognize(topRegion, {}, { text: true, tsv: true }), deadline).catch((error) => {
      if (error instanceof VisualPdfExtractionError) throw error
      throw new VisualPdfExtractionError('VISUAL_PDF_OCR_FAILED')
    })

    const combinedText = [raw.data.text || '', enriched.data.text || ''].join('\n')
    const issueDate = recoverIssueDate(combinedText, accessKey)
    const rawDueDate = recoverDueDateFromTsv(raw.data.tsv, issueDate)
    const enrichedDueDate = recoverDueDateFromTsv(enriched.data.tsv, issueDate)
    let dueDate = rawDueDate && enrichedDueDate && rawDueDate === enrichedDueDate
      ? rawDueDate
      : rawDueDate || enrichedDueDate
    if (!dueDate) {
      const dueRegion = anchorRegionFromTsv(raw.data.tsv, 'VENCIMENTO', metadata.width, metadata.height)
      if (dueRegion) {
        const dueImage = await withinDeadline(
          sharp(image).extract(dueRegion)
            .resize({ width: dueRegion.width * 3, height: dueRegion.height * 2, fit: 'fill' })
            .grayscale().normalize().sharpen().png().toBuffer(),
          deadline,
        )
        await withinDeadline(worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
          tessedit_char_whitelist: '0123456789/',
        }), deadline)
        const dueOcr = await withinDeadline(
          worker.recognize(dueImage),
          deadline,
        ).catch((error) => {
          if (error instanceof VisualPdfExtractionError) throw error
          throw new VisualPdfExtractionError('VISUAL_PDF_OCR_FAILED')
        })
        dueDate = datesFromVisualParts([dueOcr.data.text || ''], issueDate)[0]
        await withinDeadline(worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          tessedit_char_whitelist: '',
        }), deadline)
      }
    }
    dueDate ||= recoverDueDate(combinedText, issueDate)
    let canonicalTotal = corroboratedCanonicalTotal(raw.data.tsv, enriched.data.tsv, combinedText)
    if (!canonicalTotal) {
      const normalizedImage = await withinDeadline(
        sharp(image).grayscale().normalize().sharpen().png().toBuffer(),
        deadline,
      )
      const normalized = await withinDeadline(
        worker.recognize(normalizedImage, {}, { text: true, tsv: true }),
        deadline,
      ).catch((error) => {
        if (error instanceof VisualPdfExtractionError) throw error
        throw new VisualPdfExtractionError('VISUAL_PDF_OCR_FAILED')
      })
      canonicalTotal = corroboratedCanonicalTotal(raw.data.tsv, enriched.data.tsv, combinedText, normalized.data.tsv)
    }

    return {
      text: composeVisualDanfeText({
        rawText: raw.data.text || '',
        enrichedText: enriched.data.text || '',
        accessKey,
        canonicalTotal,
        dueDate,
      }),
      accessKey,
      ocrConfidence: Math.min(raw.data.confidence, enriched.data.confidence),
      durationMs: Math.round(performance.now() - started),
      pageCount: document.length,
      fallbackTriggerReason,
    }
  } finally {
    await worker?.terminate().catch(() => undefined)
    await document?.destroy().catch(() => undefined)
  }
}

export async function extractDanfeVisualText(
  buffer: Buffer,
  fallbackTriggerReason: VisualFallbackReason,
): Promise<VisualPdfExtraction> {
  const release = await acquireFallbackSlot()
  try {
    return await extractVisualText(buffer, fallbackTriggerReason)
  } finally {
    release()
  }
}
