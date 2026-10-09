/** Entirely synthetic facts; no customer PDF or fiscal identity is committed. */
export function municipalFixture() {
  return {
    document_kind: 'nfse_municipal', document_count: 1, ambiguous: false,
    titulo: 'NOTA FISCAL ELETRONICA DE SERVICOS', orgao_emissor: 'PREFEITURA MUNICIPAL DE CIDADE QA', confidence: 0.96,
    numero_nf: { label: 'Número da Nota', value: '0001234' },
    codigo_verificacao: { label: 'Código Autenticidade', value: 'QA.1234.5678-X' },
    data_emissao: { label: 'Data Emissão', value: '02/10/2026' },
    cnpj_emitente: { label: 'CNPJ/CPF', value: '11.222.333/0001-81' },
    razao_social_emitente: { label: 'Prestador de Serviços', value: 'PRESTADOR SINTETICO LTDA' },
    cnpj_destinatario: { label: 'CPF/CNPJ', value: '98.100.001/0001-02' },
    razao_social_destinatario: { label: 'Nome Tomador de Serviços', value: 'TOMADOR SINTETICO LTDA' },
    valor_bruto: { label: 'VALOR TOTAL DA NOTA', value: 'R$ 12.345,67' },
    valor_liquido: { label: null, value: null }, data_vencimento: { label: null, value: null },
  }
}
