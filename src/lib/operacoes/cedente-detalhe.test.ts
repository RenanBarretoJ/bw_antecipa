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
