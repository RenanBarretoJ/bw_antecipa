/** Fiscal deductions only. Financial discount/interest never enters this calculation. */
export const retentionCodes = ['IRRF', 'PIS', 'COFINS', 'CSLL', 'INSS', 'ISS_RETIDO', 'TOTAL_RETENCOES'] as const
export type RetentionCode = typeof retentionCodes[number]
export type FiscalRetention = { codigo: RetentionCode; valor: number; rotulo: string }
export type NetCalculation = {
  versao: 1
  formula: 'BRUTO_MENOS_RETENCOES'
  completo: true
  bruto: number
  componentes: FiscalRetention[]
  total_retencoes: number
  liquido: number
}

function cents(value: number): number {
  const rounded = Math.round(value * 100)
  if (!Number.isFinite(value) || !Number.isSafeInteger(rounded) || value < 0
    || Math.abs(value * 100 - rounded) > 0.00001) throw new Error('NFSE_RETENTIONS_INVALID')
  return rounded
}

export function calculateFiscalNet(gross: number, components: FiscalRetention[]): NetCalculation {
  const bruto = cents(gross)
  const codes = new Set(components.map(c => c.codigo))
  if (!bruto || !components.length || components.length > 6 || codes.size !== components.length
    || (codes.has('TOTAL_RETENCOES') && codes.size !== 1)) throw new Error('NFSE_RETENTIONS_INVALID')
  const total = components.reduce((sum, c) => {
    if (!retentionCodes.includes(c.codigo) || !c.rotulo.trim() || c.rotulo.length > 200) throw new Error('NFSE_RETENTIONS_INVALID')
    return sum + cents(c.valor)
  }, 0)
  if (!Number.isSafeInteger(total) || total >= bruto) throw new Error('NFSE_RETENTIONS_INVALID')
  return { versao: 1, formula: 'BRUTO_MENOS_RETENCOES', completo: true, bruto: bruto / 100,
    componentes: components, total_retencoes: total / 100, liquido: (bruto - total) / 100 }
}
