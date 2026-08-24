import { describe, expect, it } from 'vitest'
import { contemCampoTecnicoExposto, montarDetalheOperacaoCedente, type EntregaCedenteRaw, type NotaFiscalCedenteRaw, type OperacaoCedenteRaw, type RequisitoCedenteRaw } from './cedente-detalhe'
import { construirEtapasCronologicasOperacao, obterCapacidadesOperacao } from './politica-operacao'

const operacaoBase: OperacaoCedenteRaw = {
  id: '22608637-7555-40dc-b4d7-0c9d2a551256',
  cedente_id: 'cedente-1',
  cedente_fundo_id: 'vinculo-1',
  valor_bruto_total: 10000,
  taxa_desconto: 3.99,
  prazo_dias: 53,
  valor_liquido_desembolso: 9300,
  data_vencimento: '2026-09-13',
  status: 'em_andamento',
  aceite_sacado_exigido: false,
  aceite_sacado_status: 'dispensado',
  aceite_sacado_em: null,
  aprovado_em: '2026-07-22T12:00:00.000Z',
  cessao_efetivada_em: '2026-07-23T12:00:00.000Z',
  liquidada_em: null,
  created_at: '2026-07-21T12:00:00.000Z',
  motivo_reprovacao: null,
  termo_assinado_url: 'operacoes/termo.pdf',
  comprovante_pagamento_url: 'operacoes/comprovante.pdf',
  quitacao_assinada_url: null,
  cedentes: { razao_social: 'FORMAPLAN FORMAS PLANEJADAS INDUSTRIA E COMERCIO LTDA', cnpj: '00262371000575' },
}

const nfs: NotaFiscalCedenteRaw[] = [{
  id: 'nf-1',
  numero_nf: '13197',
  cnpj_destinatario: '40439661000132',
  razao_social_destinatario: 'SPE PAUPINA EMPREENDIMENTOS LTDA',
  valor_bruto: 10000,
  valor_liquido: 9300,
  valor_antecipado: 9300,
  data_vencimento: '2026-09-13',
  status: 'em_antecipacao',
}]

const entregas: EntregaCedenteRaw[] = [{
  id: 'entrega-1',
  nota_fiscal_id: 'nf-1',
  status_entrega: 'em_transito',
  data_limite_cte: '2026-07-30',
  data_limite_canhoto: '2026-08-02',
  data_entrega: null,
  entrega_confirmada_em: null,
  motivo_pendencia: null,
}]

describe('detalhe da operação para cedente', () => {
  it('monta resumo financeiro distinguindo aprovado de desembolsado', () => {
    const detalhe = montarDetalheOperacaoCedente({ operacao: operacaoBase, notasFiscais: nfs, entregas: [], requisitos: [] })

    expect(detalhe.financeiro.valorLiquidoAprovado).toBe(9300)
    expect(detalhe.financeiro.valorEfetivamenteDesembolsado).toBe(9300)
    expect(detalhe.financeiro.desembolsadoEm).toBe('2026-07-23T12:00:00.000Z')
  })

  it('mantem valor desembolsado vazio antes do desembolso', () => {
    const detalhe = montarDetalheOperacaoCedente({
      operacao: { ...operacaoBase, status: 'aprovada', cessao_efetivada_em: null },
      notasFiscais: nfs,
      entregas: [],
      requisitos: [],
    })

    expect(detalhe.financeiro.valorLiquidoAprovado).toBe(9300)
    expect(detalhe.financeiro.valorEfetivamenteDesembolsado).toBeNull()
    expect(detalhe.timeline.find((step) => step.id === 'desembolso')?.status).toBe('atual')
  })

  it('inclui NFs corretas com link para a tela do cedente', () => {
    const detalhe = montarDetalheOperacaoCedente({ operacao: operacaoBase, notasFiscais: nfs, entregas: [], requisitos: [] })

    expect(detalhe.notasFiscais).toHaveLength(1)
    expect(detalhe.notasFiscais[0]).toMatchObject({
      numero: '13197',
      sacado: 'SPE PAUPINA EMPREENDIMENTOS LTDA',
      href: '/cedente/notas-fiscais/nf-1',
    })
  })

  it('mostra somente parcelas cedidas e mantém VP/desconto vazios antes da aprovação', () => {
    const detalhe = montarDetalheOperacaoCedente({
      operacao: { ...operacaoBase, status: 'solicitada', valor_liquido_desembolso: null, aprovado_em: null, cessao_efetivada_em: null },
      notasFiscais: nfs,
      entregas: [],
      requisitos: [],
      totaisParcelas: [{ nota_fiscal_id: 'nf-1' }, { nota_fiscal_id: 'nf-1' }, { nota_fiscal_id: 'nf-1' }],
      parcelasCedidas: [
        { nota_fiscal_id: 'nf-1', parcela_id: 'p-3', numero_parcela: 3, valor_nominal: 3500, data_vencimento: '2026-10-10' },
        { nota_fiscal_id: 'nf-1', parcela_id: 'p-1', numero_parcela: 1, valor_nominal: 2500, data_vencimento: '2026-08-10' },
      ],
    })

    expect(detalhe.notasFiscais[0]).toMatchObject({
      totalParcelas: 3,
      valorBruto: 6000,
      valorAntecipado: null,
    })
    expect(detalhe.notasFiscais[0].parcelasCedidas.map((item) => item.parcelaId)).toEqual(['p-1', 'p-3'])
    expect(detalhe.fluxoFinanceiro.map((item) => item.parcelaId)).toEqual(['p-1', 'p-3'])
    expect(detalhe.fluxoFinanceiro.every((item) => item.valorAntecipado === null && item.desconto === null && item.statusFinanceiro === null)).toBe(true)
  })

  it('usa memória aprovada por parcela e ordena fluxo multi-NF cronologicamente', () => {
    const notasMulti: NotaFiscalCedenteRaw[] = [
      nfs[0],
      { ...nfs[0], id: 'nf-2', numero_nf: '13200', valor_bruto: 8000, data_vencimento: '2026-09-01' },
    ]
    const detalhe = montarDetalheOperacaoCedente({
      operacao: { ...operacaoBase, status: 'aprovada', cessao_efetivada_em: null },
      notasFiscais: notasMulti,
      entregas: [],
      requisitos: [],
      totaisParcelas: [{ nota_fiscal_id: 'nf-1' }, { nota_fiscal_id: 'nf-1' }, { nota_fiscal_id: 'nf-2' }],
      parcelasCedidas: [
        { nota_fiscal_id: 'nf-1', parcela_id: 'p-2', numero_parcela: 2, valor_nominal: 4000, data_vencimento: '2026-09-15' },
        { nota_fiscal_id: 'nf-2', parcela_id: 'p-4', numero_parcela: 1, valor_nominal: 3000, data_vencimento: '2026-08-20' },
      ],
      memoriasCalculo: [
        { nota_fiscal_id: 'nf-1', parcela_id: 'p-2', dias_aplicados: 16, vencimento_contratual: '2026-09-15', valor_nominal: 4000, valor_presente: 3801.23, desconto: 198.77 },
        { nota_fiscal_id: 'nf-2', parcela_id: 'p-4', dias_aplicados: 8, vencimento_contratual: '2026-08-20', valor_nominal: 3000, valor_presente: 2920.11, desconto: 79.89 },
      ],
    })

    expect(detalhe.notasFiscais.find((nf) => nf.id === 'nf-1')?.valorAntecipado).toBe(3801.23)
    expect(detalhe.notasFiscais.find((nf) => nf.id === 'nf-2')?.valorAntecipado).toBe(2920.11)
    expect(detalhe.fluxoFinanceiro.map((item) => `${item.notaFiscalId}:${item.parcelaId}`)).toEqual(['nf-2:p-4', 'nf-1:p-2'])
    expect(detalhe.fluxoFinanceiro.every((item) => item.statusFinanceiro === 'Cronograma aprovado')).toBe(true)
  })

  it('mostra status em trânsito e prazo logístico', () => {
    const detalhe = montarDetalheOperacaoCedente({ operacao: operacaoBase, notasFiscais: nfs, entregas, requisitos: [], today: new Date('2026-07-24T12:00:00.000Z') })

    expect(detalhe.logistica.habilitada).toBe(true)
    expect(detalhe.logistica.statusLabel).toBe('Em trânsito')
    expect(detalhe.logistica.emTransito).toBe(1)
    expect(detalhe.logistica.prazoMaisProximo).toBe('2026-07-30')
    expect(detalhe.logistica.diasPrazoMaisProximo).toBe(6)
  })

  it('exibe pendência pós-cessão que depende do cedente', () => {
    const requisitos: RequisitoCedenteRaw[] = [{
      id: 'req-1',
      tipo_documento_codigo_snapshot: 'comprovante_entrega',
      escopo_snapshot: 'entrega',
      nota_fiscal_id: null,
      nota_fiscal_entrega_id: 'entrega-1',
      operacao_id: null,
      status: 'pendente',
      obrigatorio: true,
      prazo_limite: '2026-08-02',
      responsavel_upload_snapshot: 'cedente',
    }]

    const detalhe = montarDetalheOperacaoCedente({ operacao: operacaoBase, notasFiscais: nfs, entregas, requisitos, today: new Date('2026-07-24T12:00:00.000Z') })

    expect(detalhe.possuiPendenciaCedente).toBe(true)
    expect(detalhe.pendenciasCedente[0]).toMatchObject({
      descricao: 'Comprovante de entrega obrigatório pendente',
      notaFiscalId: 'nf-1',
      acaoHref: '/cedente/notas-fiscais/nf-1',
      dias: 9,
    })
  })

  it('mostra estado limpo quando não há pendências do cedente', () => {
    const detalhe = montarDetalheOperacaoCedente({ operacao: operacaoBase, notasFiscais: nfs, entregas, requisitos: [] })

    expect(detalhe.possuiPendenciaCedente).toBe(false)
    expect(detalhe.pendenciasCedente).toEqual([])
  })

  it('registra liquidação na timeline', () => {
    const detalhe = montarDetalheOperacaoCedente({
      operacao: { ...operacaoBase, status: 'liquidada', liquidada_em: '2026-09-14T12:00:00.000Z', quitacao_assinada_url: 'operacoes/quitacao.pdf' },
      notasFiscais: nfs,
      entregas: [{ ...entregas[0], status_entrega: 'entregue', entrega_confirmada_em: '2026-08-01T12:00:00.000Z' }],
      requisitos: [],
    })

    expect(detalhe.timeline.find((step) => step.id === 'liquidacao')).toMatchObject({
      status: 'concluida',
      concluidaEm: '2026-09-14T12:00:00.000Z',
    })
    expect(detalhe.comprovantes.map((item) => item.key)).toContain('quitacao_assinada')
  })

  it('usa no cedente a mesma sequência construída pelo domínio compartilhado', () => {
    const detalhe = montarDetalheOperacaoCedente({
      operacao: operacaoBase,
      notasFiscais: nfs,
      entregas,
      requisitos: [],
    })
    const capacidades = obterCapacidadesOperacao(operacaoBase, {
      documentos: [],
      logistica: entregas,
    })

    expect(detalhe.timeline).toEqual(construirEtapasCronologicasOperacao({
      operacao: operacaoBase,
      capacidades,
      documentos: [],
      logistica: entregas,
    }))
  })

  it('não expõe Pagamento identificado apesar do comprovante legado existir', () => {
    const detalhe = montarDetalheOperacaoCedente({
      operacao: operacaoBase,
      notasFiscais: nfs,
      entregas: [],
      requisitos: [],
    })

    expect(operacaoBase.comprovante_pagamento_url).toBeTruthy()
    expect(detalhe.timeline.some((step) => step.id === 'pagamento')).toBe(false)
  })

  it('não expõe campos técnicos de CNAB, integração ou Portal FIDC na projeção', () => {
    const detalhe = montarDetalheOperacaoCedente({ operacao: operacaoBase, notasFiscais: nfs, entregas, requisitos: [] })

    expect(contemCampoTecnicoExposto(detalhe)).toBe(false)
    expect(JSON.stringify(detalhe)).not.toContain('remessa_url')
    expect(JSON.stringify(detalhe)).not.toContain('remessa_fromtis')
  })
})
