import { prepareNfsePersistence } from '@/lib/nfse/persistence'
import { FiscalIntakeError, type FiscalFacts, type FiscalScope, type PreparedFiscal } from './contracts'

export function prepareFiscalPersistence(input: {
  facts: FiscalFacts; scope: FiscalScope; sha256: string; today: string; verifiedManualDue?: string
}): PreparedFiscal | ReturnType<typeof prepareNfsePersistence> & { kind: 'review' } {
  const { facts, scope, sha256, today } = input
  const taxes = { valor_icms: 0, valor_iss: 0, valor_pis: 0, valor_cofins: 0, valor_ipi: 0 }
  if (facts.kind === 'NFSE') {
    const result = prepareNfsePersistence(facts.parsed, input.verifiedManualDue ?? '', sha256, today)
    if (result.kind === 'review') return result
    return { values: { ...taxes, ...result.values }, parcelas: [] }
  }
  if (facts.kind === 'XML') {
    const p = facts.parsed
    return { values: {
      numero_nf: p.numero_nf, serie: p.serie || null, chave_acesso: facts.key,
      data_emissao: p.data_emissao, data_vencimento: p.data_vencimento || p.data_emissao,
      cnpj_emitente: p.cnpj_emitente, razao_social_emitente: p.razao_social_emitente,
      cnpj_destinatario: p.cnpj_destinatario, razao_social_destinatario: p.razao_social_destinatario,
      valor_bruto: p.valor_bruto, valor_liquido: p.valor_liquido, valor_icms: p.valor_icms, valor_iss: p.valor_iss,
      valor_pis: p.valor_pis, valor_cofins: p.valor_cofins, valor_ipi: p.valor_ipi,
      descricao_itens: p.descricao_itens || null, quantidade_total: p.itensEstruturados.length ? p.quantidadeTotal : null,
      unidade_quantidade: p.itensEstruturados[0]?.unidade || null, itens_estruturados: p.itensEstruturados.length ? p.itensEstruturados : null,
      condicao_pagamento: p.condicao_pagamento || null, tipo_documento_fiscal: 'NFE',
      fiscal_proveniencia: { strategy: 'xml', sha256 },
    }, parcelas: p.parcelas }
  }
  const p = facts.parsed
  if (!p.valor_bruto || !p.numero_nf) throw new FiscalIntakeError('INVALID')
  return { values: {
    ...taxes, numero_nf: p.numero_nf, serie: p.serie ?? null, chave_acesso: facts.key,
    data_emissao: p.data_emissao ?? today, data_vencimento: p.data_vencimento ?? today,
    cnpj_emitente: scope.cnpj, razao_social_emitente: scope.razaoSocial,
    cnpj_destinatario: p.cnpj_destinatario ?? '', razao_social_destinatario: p.razao_social_destinatario ?? '',
    valor_bruto: p.valor_bruto, valor_liquido: p.valor_bruto, condicao_pagamento: p.condicao_pagamento ?? null,
    descricao_itens: p.descricao_itens ?? null, tipo_documento_fiscal: 'NFE',
    fiscal_proveniencia: { strategy: p.strategies?.[0] ?? 'pdf', sha256 },
  }, parcelas: [] }
}
