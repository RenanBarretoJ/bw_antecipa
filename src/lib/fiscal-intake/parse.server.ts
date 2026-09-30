import 'server-only'
import { extrairChaveAcessoNfeDoXml, validarXmlNfeParaUploadCedente } from '@/lib/notas-fiscais/emitente-autorizado'
import { extractDanfeFromPdf, validarDanfeParaPersistencia } from '@/lib/pdf-nf-parser'
import { probeNfsePdf } from '@/lib/nfse/pdf-dispatcher.server'
import { validateNfseExtraction } from '@/lib/nfse/danfse-v2'
import { FiscalIntakeError, type FiscalFacts } from './contracts'

/** Shared dispatch only: all fiscal extraction stays in the official parsers. */
export async function parseFiscalFile(file: File): Promise<FiscalFacts> {
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) throw new FiscalIntakeError('INVALID')
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'xml') {
    const xml = await file.text()
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new FiscalIntakeError('INVALID')
    const key = extrairChaveAcessoNfeDoXml(xml)
    if (!/^\d{44}$/.test(key)) throw new FiscalIntakeError('MISSING_IDENTITY')
    // This checks fiscal consistency, not authorization. The establishment/fund
    // domain guard resolves the issuer afterwards for BOTH human and system.
    const result = validarXmlNfeParaUploadCedente({ xmlContent: xml, cnpjCedente: key.slice(6, 20), permitirEstabelecimentoDoCedente: true })
    if (!result.ok) throw new FiscalIntakeError('INVALID')
    return { kind: 'XML', documentType: 'NFE', key, issuerCnpj: result.cnpjEmitente, parsed: result.parsed }
  }
  if (extension !== 'pdf') throw new FiscalIntakeError('INVALID')
  const bytes = Buffer.from(await file.arrayBuffer())
  if (!bytes.subarray(0, 1024).toString('utf8').trimStart().startsWith('%PDF-')) throw new FiscalIntakeError('INVALID')
  if (process.env.NFSE_UPLOAD_ENABLED === 'true') {
    const nfse = await probeNfsePdf(bytes)
    if (nfse) {
      const key = nfse.dados.chave_acesso
      const issuerCnpj = nfse.dados.cnpj_emitente
      if (!key || !/^\d{50}$/.test(key) || !issuerCnpj) throw new FiscalIntakeError('MISSING_IDENTITY')
      if (!validateNfseExtraction(nfse).ok) throw new FiscalIntakeError('AMBIGUOUS')
      return { kind: 'NFSE', documentType: 'NFSE', key, issuerCnpj, parsed: nfse }
    }
  }
  const danfe = await extractDanfeFromPdf(bytes)
  if (!danfe.chave_acesso || !/^\d{44}$/.test(danfe.chave_acesso)) throw new FiscalIntakeError('MISSING_IDENTITY')
  if (!validarDanfeParaPersistencia(danfe).ok) throw new FiscalIntakeError('AMBIGUOUS')
  return { kind: 'DANFE', documentType: 'NFE', key: danfe.chave_acesso, issuerCnpj: danfe.chave_acesso.slice(6, 20), parsed: danfe }
}
