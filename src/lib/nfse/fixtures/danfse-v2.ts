/** Dados sintéticos: não são documentos fiscais e não comprovam leitura de PDF imagem. */
export const SYNTHETIC_KEY = '1234567890'.repeat(5)

export function danfseFixture(variant: 'A' | 'B' = 'A'): string {
  const values = variant === 'A'
    ? { number: '49', date: '14/09/2026', period: '09/09/2026', gross: '39.521,98', net: '37.229,70', deductions: '2.292,28' }
    : { number: '232', date: '15/09/2026', period: '15/09/2026', gross: '112.710,81', net: '105.779,10', deductions: '6.931,71' }
  return `DANFSe v2.0
Documento Auxiliar da NFS-e
CHAVE DE ACESSO DA NFS-e
${SYNTHETIC_KEY}
NÚMERO DA NFS-e
${values.number}
COMPETÊNCIA DA NFS-e
${values.period}
DATA E HORA DA EMISSÃO DA NFS-e
${values.date} 16:44:46
NÚMERO DA DPS
13
SÉRIE DA DPS
1
DATA E HORA DA EMISSÃO DA DPS
01/09/2026 10:00:00
PRESTADOR / FORNECEDOR
CNPJ / CPF / NIF
11.222.333/0001-81
Nome / Nome Empresarial
PRESTADOR SINTETICO QA LTDA
Município / Sigla UF
CIDADE QA / RS
Endereço
RUA SINTETICA, 100, CENTRO
TOMADOR / ADQUIRENTE
CNPJ / CPF / NIF
98.100.001/0001-02
Nome / Nome Empresarial
TOMADOR SINTETICO QA LTDA
Município / Sigla UF
CIDADE QA / RS
Endereço
RUA AMOSTRA, 200, CENTRO
DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e
SERVIÇO PRESTADO
Descrição do Serviço
Serviços sintéticos para QA
TRIBUTAÇÃO MUNICIPAL (ISSQN)
BC ISSQN
R$ 900.000,00
VALOR TOTAL DA NFS-e
VALOR DA OPERAÇÃO / SERVIÇO
R$ ${values.gross}
Desconto Incondicionado
R$ 395,22
Total das Retenções (ISSQN / Federais)
R$ ${values.deductions}
VALOR LÍQUIDO DA NFS-e
R$ ${values.net}
Total do IBS/CBS
R$ 146,82
VALOR LÍQUIDO DA NFS-e + IBS/CBS
R$ 37.376,52
INFORMAÇÕES COMPLEMENTARES
NFS-e Subst.: ${'9876543210'.repeat(5)}
SEM VALOR FISCAL`
}
