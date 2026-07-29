import { describe, expect, it } from 'vitest'
import {
  avaliarChecklistDaNotaComDados,
  type RequisitoAprovacaoComDados,
} from './avaliacao-checklist-aprovacao'

function requisito(
  overrides: Partial<RequisitoAprovacaoComDados> = {},
): RequisitoAprovacaoComDados {
  return {
    notaFiscalId: 'nf-1',
    requisitoId: 'req-1',
    nome: 'Pedido de compra',
    tipoDocumento: 'nf_pedido_compra',
    escopo: 'nf_pre_cessao',
    obrigatorio: true,
    bloqueiaFluxo: true,
    momento: 'antes_cessao',
    regraValidade: 'manual',
    statusInstancia: 'pendente',
    documentoId: 'doc-1',
    versaoAprovadaId: null,
    versaoAtual: {
      id: 'versao-1',
      status: 'em_analise',
      ultimaAnalise: null,
    },
    ...overrides,
  }
}

describe('avaliacao documental compartilhada da NF', () => {
  it('bloqueia requisito obrigatorio aguardando analise', () => {
    expect(avaliarChecklistDaNotaComDados({
      notaFiscalId: 'nf-1',
      requisitos: [requisito()],
    })).toMatchObject({
      elegivel: false,
      requisitosEmAnalise: ['Pedido de compra'],
      totalObrigatorios: 1,
      pendentesObrigatorios: 1,
    })
  })

  it('libera quando a versao atual esta aprovada', () => {
    expect(avaliarChecklistDaNotaComDados({
      notaFiscalId: 'nf-1',
      requisitos: [requisito({
        versaoAprovadaId: 'versao-1',
        versaoAtual: {
          id: 'versao-1',
          status: 'aprovado',
          ultimaAnalise: { resultado: 'aprovado' },
        },
      })],
    })).toMatchObject({
      elegivel: true,
      totalObrigatorios: 1,
      concluidosObrigatorios: 1,
      pendentesObrigatorios: 0,
    })
  })

  it('nao bloqueia requisito opcional pendente', () => {
    expect(avaliarChecklistDaNotaComDados({
      notaFiscalId: 'nf-1',
      requisitos: [
        requisito({
          requisitoId: 'req-obrigatorio',
          versaoAprovadaId: 'versao-1',
          versaoAtual: { id: 'versao-1', status: 'aprovado', ultimaAnalise: null },
        }),
        requisito({
          requisitoId: 'req-opcional',
          nome: 'Boleto',
          obrigatorio: false,
          bloqueiaFluxo: false,
          documentoId: null,
          versaoAtual: null,
        }),
      ],
    }).elegivel).toBe(true)
  })

  it('ignora requisito pos-cessao na aprovacao da NF', () => {
    expect(avaliarChecklistDaNotaComDados({
      notaFiscalId: 'nf-1',
      requisitos: [
        requisito({
          requisitoId: 'req-obrigatorio',
          versaoAprovadaId: 'versao-1',
          versaoAtual: { id: 'versao-1', status: 'aprovado', ultimaAnalise: null },
        }),
        requisito({
          requisitoId: 'req-pos',
          nome: 'Comprovante de entrega',
          escopo: 'nf_pos_cessao',
          documentoId: null,
          versaoAtual: null,
        }),
      ],
    }).elegivel).toBe(true)
  })

  it('identifica rejeicao da versao atual', () => {
    expect(avaliarChecklistDaNotaComDados({
      notaFiscalId: 'nf-1',
      requisitos: [requisito({
        versaoAtual: {
          id: 'versao-1',
          status: 'rejeitado',
          ultimaAnalise: { resultado: 'rejeitado' },
        },
      })],
    })).toMatchObject({
      elegivel: false,
      possuiRejeicao: true,
      requisitosRejeitados: ['Pedido de compra'],
    })
  })

  it('bloqueia checklist ainda nao instanciado', () => {
    expect(avaliarChecklistDaNotaComDados({
      notaFiscalId: 'nf-sem-checklist',
      requisitos: [],
    })).toMatchObject({
      elegivel: false,
      requisitosPendentes: ['Checklist documental'],
    })
  })
})
