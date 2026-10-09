import { createHash } from 'node:crypto'
import type { NfseExtraction, NfseFiscalData } from './contracts'

const materialFields: (keyof NfseFiscalData)[] = [
  'numero_nf', 'chave_acesso', 'cnpj_emitente', 'razao_social_emitente',
  'cnpj_destinatario', 'razao_social_destinatario', 'competencia', 'data_emissao',
  'data_vencimento', 'valor_bruto', 'valor_liquido', 'total_retencoes',
  'desconto_incondicionado', 'valor_liquido_com_ibscbs',
]
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

export function nfseIdentity(extraction: NfseExtraction): string {
  if (extraction.strategy !== 'nfse_municipal_visual') {
    if (!extraction.dados.chave_acesso) throw new Error('NFSE_IDENTITY_MISSING')
    return extraction.dados.chave_acesso
  }
  const { cnpj_emitente, orgao_emissor, numero_nf } = extraction.dados
  if (!cnpj_emitente || !orgao_emissor || !numero_nf) throw new Error('NFSE_IDENTITY_MISSING')
  return JSON.stringify(['NFSE_MUNICIPAL', cnpj_emitente, orgao_emissor, numero_nf])
}

/** Strategy/provenance/confidence are not identity. Fiscal changes always fail closed. */
export function fiscalFingerprint(extraction: NfseExtraction): string {
  // Preserve fingerprints of open national reviews from before this extension.
  const fields = extraction.strategy === 'nfse_municipal_visual'
    ? [...materialFields, 'orgao_emissor', 'codigo_verificacao'] as (keyof NfseFiscalData)[] : materialFields
  const facts = fields.map(field => {
    const value = extraction.dados[field]
    return [field, typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : value ?? null]
  })
  if (extraction.calculo_liquido) {
    // Stable across JSONB key ordering, while preserving old review fingerprints.
    const calc = extraction.calculo_liquido
    facts.push(['calculo_liquido', JSON.stringify([calc.versao, calc.formula, calc.completo, calc.bruto,
      calc.total_retencoes, calc.liquido, calc.componentes.map(c => [c.codigo, c.valor, c.rotulo])])])
  }
  return sha256(JSON.stringify(facts))
}
