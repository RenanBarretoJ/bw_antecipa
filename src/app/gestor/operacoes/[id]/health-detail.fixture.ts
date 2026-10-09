import type { BaseAntecipacaoSnapshot } from '@/lib/operacoes/base-antecipacao'

/** Synthetic equivalent of the incident shape. No production identities or documents. */
export function healthDetailFixture(tipoDocumentoFiscal: string | null = null) {
  const notas = Array.from({ length: 15 }, (_, index) => ({
    id: `qa-nf-${index + 1}`, numero_nf: `QA-${index + 1}`,
    tipo_documento_fiscal: tipoDocumentoFiscal,
    cnpj_destinatario: '00000000000000', razao_social_destinatario: 'SACADO QA',
    valor_bruto: index === 14 ? 68579.15 : 35000,
    valor_liquido: index === 14 ? 68579.15 : 35000,
    valor_antecipado: null, data_vencimento: '2026-10-17', status: 'aprovada',
  }))
  const snapshot: BaseAntecipacaoSnapshot = {
    schema: 'bw-antecipa.base-antecipacao.v1', base: 'BRUTO',
    cedente_id: 'qa-cedente', fundo_id: 'qa-fundo', cedente_fundo_id: 'qa-vinculo',
    politica_operacional_versao_id: 'qa-politica', capturado_em: '2026-10-02T12:00:00Z',
    notas: notas.map((nf) => ({ nota_fiscal_id: nf.id, valor_bruto_fiscal: nf.valor_bruto,
      valor_liquido_fiscal: nf.valor_liquido, valor_liquido_origem: null, valor_base: nf.valor_bruto })),
    itens: notas.map((nf) => ({ nota_fiscal_id: nf.id, parcela_id: `${nf.id}-p1`,
      valor_base: nf.valor_bruto, vencimento: nf.data_vencimento })),
  }
  const parcelas = new Map(notas.map((nf) => [nf.id, [{
    parcelaId: `${nf.id}-p1`, numeroParcela: 1, valorNominal: nf.valor_bruto,
    dataVencimento: nf.data_vencimento, diasAplicados: null, valorPresente: null, desconto: null,
  }]]))
  const operacao = {
    id: 'qa-health-operacao', cedente_id: 'qa-cedente', cedente_fundo_id: 'qa-vinculo',
    status: 'solicitada', valor_bruto_total: 558579.15, taxa_desconto: 3.29,
    prazo_dias: 15, valor_liquido_desembolso: 549886.30,
    created_at: '2026-10-02T12:00:00Z', data_vencimento: '2026-10-17',
    metodo_calculo_financeiro: 'TRINTA_360', taxa_proposta_consultor: null,
    aceite_sacado_exigido: true, aceite_sacado_status: 'pendente',
    base_antecipacao_snapshot: snapshot as BaseAntecipacaoSnapshot | null,
    politica_snapshot: {
      schema: 'bw-antecipa.politica-operacional.v1', requisitos: [], configuracao: {},
      aceite_sacado_obrigatorio: true, cria_acompanhamento_entrega: false,
      controle_exposicao_logistica_ativo: false, limite_exposicao_em_transito_pct: null,
      gate_risco_ativo: false, base_valor_antecipacao: 'BRUTO',
      calculo_financeiro: { metodo: 'TRINTA_360', versao_motor: 2 },
    },
    cedentes: { razao_social: 'CEDENTE QA HEALTH', cnpj: '00000000000000',
      contrato_url: null, contrato_assinado_url: null },
  }
  return { operacao, notas, parcelas, snapshot }
}
