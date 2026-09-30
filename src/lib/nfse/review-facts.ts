import { createHash } from 'node:crypto'
import type { NfseExtraction, NfseFiscalData } from './contracts'

const materialFields: (keyof NfseFiscalData)[] = [
  'numero_nf', 'chave_acesso', 'cnpj_emitente', 'razao_social_emitente',
  'cnpj_destinatario', 'razao_social_destinatario', 'competencia', 'data_emissao',
  'data_vencimento', 'valor_bruto', 'valor_liquido', 'total_retencoes',
  'desconto_incondicionado', 'valor_liquido_com_ibscbs',
]
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

/** Strategy/provenance/confidence are not identity. Fiscal changes always fail closed. */
export function fiscalFingerprint(extraction: NfseExtraction): string {
  return sha256(JSON.stringify(materialFields.map(field => {
    const value = extraction.dados[field]
    return [field, typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : value ?? null]
  })))
}
