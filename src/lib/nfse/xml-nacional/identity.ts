import type { CanonicalDocument } from '../canonical/schema'
import { FieldReader } from './fields'
import { at, type XmlNode } from './xml-tree'

/** Structural consistency only; this does not verify DV, signature, account or tenant. */
export function validateDocumentIdentity(reader: FieldReader, doc: CanonicalDocument, info: XmlNode): void {
  const dps = doc.natureza_documento === 'NFSE' ? at(info, 'DPS/infDPS') : info
  const dpsId = doc.identificacao.dps.id.valor
  if (dpsId) {
    const serie = doc.identificacao.dps.serie.valor
    const number = doc.identificacao.dps.numero.valor
    const municipality = doc.identificacao.municipio_emissor.valor
    if ((serie && dpsId.slice(25, 30) !== serie.padStart(5, '0')) ||
        (number && dpsId.slice(30) !== number.padStart(15, '0')) ||
        (municipality && dpsId.slice(3, 10) !== municipality)) reader.issues.push('ID_DPS_DIVERGE_DOS_CAMPOS')
    // tpEmit distinguishes the issuer of the declaration from the service provider.
    const issuerGroup = { '1': 'prest', '2': 'toma', '3': 'interm' }[at(dps, 'tpEmit')?.text.trim() ?? '']
    if (issuerGroup) {
      const issuer = at(dps, issuerGroup)
      const cnpj = reader.taxId(issuer, 'CNPJ').valor
      const cpf = reader.taxId(issuer, 'CPF').valor
      const federalId = cnpj ?? cpf
      if (federalId && (dpsId.slice(11, 25) !== federalId.padStart(14, '0') || dpsId[10] !== (cnpj ? '2' : '1'))) {
        reader.issues.push('ID_DPS_DIVERGE_DO_EMITENTE_DA_DECLARACAO')
      }
    }
  }
  const key = doc.identificacao.chave_acesso.valor
  if (doc.natureza_documento !== 'NFSE' || !key) return
  const provider = doc.prestador.cnpj.valor ?? doc.prestador.cpf.valor
  if (provider && (key.slice(9, 23) !== provider.padStart(14, '0') || key[8] !== (doc.prestador.cnpj.valor ? '2' : '1'))) {
    reader.issues.push('CHAVE_NFSE_DIVERGE_DO_PRESTADOR')
  }
  const number = doc.identificacao.numero_nfse.valor
  if (number && key.slice(23, 36) !== number.padStart(13, '0')) reader.issues.push('CHAVE_NFSE_DIVERGE_DO_NUMERO')
  const municipality = doc.identificacao.municipio_emissor.valor
  if (municipality && key.slice(0, 7) !== municipality) reader.issues.push('CHAVE_NFSE_DIVERGE_DO_MUNICIPIO')
  doc.identificacao.chave_acesso.validacoes.push({ codigo: 'CHAVE_NFSE_DV', resultado: 'NAO_EXECUTADA' })
}
