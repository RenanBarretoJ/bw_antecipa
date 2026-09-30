import type { VisualNfse } from '../visual-contract'
import { SYNTHETIC_KEY } from './danfse-v2'
const fact = (label: string, value: string) => ({ label, value })
export function visualFixture(): VisualNfse {
  return {
    document_kind: 'nfse_danfse_v2', fingerprint: 'DANFSe v2.0', document_count: 1, ambiguous: false, confidence: 0.96,
    numero_nfse: fact('NÚMERO DA NFS-e', '232'), chave_acesso_nfse: fact('CHAVE DE ACESSO DA NFS-e', SYNTHETIC_KEY),
    data_emissao: fact('DATA E HORA DA EMISSÃO DA NFS-e', '15/09/2026 16:00:00'), competencia: fact('COMPETÊNCIA DA NFS-e', '15/09/2026'),
    prestador_cnpj: fact('CNPJ / CPF / NIF', '11.222.333/0001-81'), prestador_nome: fact('Nome / Nome Empresarial', 'PRESTADOR SINTETICO QA LTDA'),
    tomador_cnpj: fact('CNPJ / CPF / NIF', '98.100.001/0001-02'), tomador_nome: fact('Nome / Nome Empresarial', 'TOMADOR SINTETICO QA LTDA'),
    valor_operacao_servico: fact('VALOR DA OPERAÇÃO / SERVIÇO', 'R$ 112.710,81'), valor_liquido_nfse: fact('VALOR LÍQUIDO DA NFS-e', 'R$ 105.779,10'),
    total_retencoes: fact('Total das Retenções (ISSQN / Federais)', 'R$ 6.931,71'),
    desconto_incondicionado: { value: null, label: null }, valor_liquido_nfse_mais_ibscbs: { value: null, label: null }, vencimento: { value: null, label: null },
  }
}
