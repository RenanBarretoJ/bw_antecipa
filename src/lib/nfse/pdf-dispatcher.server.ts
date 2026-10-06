import 'server-only'
import { extractDanfseV2, isDanfseV2, validateNfseExtraction } from './danfse-v2'
import { classifyFiscalImage, extractNfseVisual } from './openai-visual.server'
import type { NfseExtraction } from './contracts'
import { readNativePdfText } from '../pdf/native-text.server'

type Dependencies = {
  native?: (buffer: Buffer) => Promise<{ text: string }>
  classify?: typeof classifyFiscalImage
  visual?: typeof extractNfseVisual
}

/** A null result delegates to the untouched NF-e pipeline. An ambiguous NFS-e never does. */
export async function probeNfsePdf(buffer: Buffer, deps: Dependencies = {}): Promise<NfseExtraction | null> {
  let text = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    text = (await Promise.race([
      readNativePdfText(buffer, deps.native),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('NFSE_NATIVE_TIMEOUT')), 20_000) }),
    ])).text
  } catch { /* typed visual classification below */ } finally { clearTimeout(timer) }
  if (isDanfseV2(text)) {
    const parsed = extractDanfseV2(text)
    // A contradiction must remain rejected; only missing structural fields permit vision.
    if (validateNfseExtraction(parsed).ok || parsed.motivos_bloqueio.length || parsed.avisos.length) return parsed
  }
  const plausiblyNfse = /DANFSE|DOCUMENTO AUXILIAR DA NFS-E/i.test(text)
  if (text.trim().length >= 50 && !plausiblyNfse) return null
  if (text.length > 1_000_000) throw new Error('NFSE_VISUAL_SIZE_INVALID')
  const kind = await (deps.classify ?? classifyFiscalImage)(buffer)
  if (kind === 'nfe_danfe' && !plausiblyNfse) return null
  if (kind !== 'nfse_danfse_v2') throw new Error('NFSE_VISUAL_CLASSIFICATION_AMBIGUOUS')
  return (deps.visual ?? extractNfseVisual)(buffer)
}
