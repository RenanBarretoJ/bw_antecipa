// Kept external by Next.js, as in the existing fiscal readers.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as NativePdfReader
export type NativePdfReader = (buffer: Buffer) => Promise<{ text: string }>

/** Existing DANFE retry policy, shared with NFS-e; callers keep their total timeout. */
export async function readNativePdfText(buffer: Buffer, reader: NativePdfReader = pdfParse): Promise<{ text: string }> {
  let failure: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await reader(Buffer.from(buffer)) }
    catch (error) { failure = error }
  }
  throw failure
}
