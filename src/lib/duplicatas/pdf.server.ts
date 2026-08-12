import 'server-only'
import { extrairDuplicataDeTexto } from './parser'

// Mantido externo ao bundle pelo serverExternalPackages do projeto.
const MAX_PAGINAS = 50
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (
  buffer: Buffer,
  options?: { max?: number },
) => Promise<{ text?: string; numpages?: number }>

export async function extrairDuplicataDePdf(buffer: Buffer) {
  try {
    const parsed = await Promise.race([
      pdfParse(buffer, { max: MAX_PAGINAS + 1 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('pdf-parse timeout')), 20_000)),
    ])
    if (Number(parsed.numpages ?? 0) > MAX_PAGINAS) {
      throw new Error(`O PDF excede o limite de ${MAX_PAGINAS} paginas.`)
    }
    return extrairDuplicataDeTexto(parsed.text ?? '')
  } catch (error) {
    if (error instanceof Error && error.message.includes('limite de')) throw error
    if (error instanceof Error && error.message.includes('timeout')) {
      throw new Error('O processamento do PDF excedeu o tempo limite.')
    }
    throw new Error('O arquivo PDF esta corrompido ou nao pode ser lido.')
  }
}
