import chromium from '@sparticuz/chromium'

const preparationKey = Symbol.for('bw-antecipa.pdf.chromium-preparation.v1')
type Preparation = { source: string | undefined; executable: Promise<string> }
const runtime = globalThis as typeof globalThis & { [preparationKey]?: Preparation }

/** Shared across route bundles in the same Node runtime, never across users' data. */
export function resolverExecutavelChromium(): Promise<string> {
  const source = process.env.CHROMIUM_BINARY_URL || undefined
  const existing = runtime[preparationKey]
  if (existing) {
    if (existing.source !== source) return Promise.reject(new Error('Chromium configuration changed within the PDF runtime.'))
    return existing.executable
  }

  const executable = Promise.resolve().then(() => source ? chromium.executablePath(source) : chromium.executablePath())
  // Retain failures too: the provider can leave a partial file after an error.
  // A new request must not launch it or restart extraction over an in-use file.
  runtime[preparationKey] = { source, executable }
  return executable
}
