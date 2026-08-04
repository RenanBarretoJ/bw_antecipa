import { describe, expect, it } from 'vitest'
import {
  avaliarElegibilidadeDocumentalDaNota,
  arquivoOriginalDaNotaValido,
  type InstanciaRequisitoAprovacao,
  type PoliticaDocumentalResolvidaNota,
  type RequisitoEsperadoAprovacao,
} from './avaliacao-checklist-aprovacao'

const politicaResolvida: PoliticaDocumentalResolvidaNota = {
  resolvida: true,
  fonte: 'politica_publicada',
  politicaId: 'politica-1',
  versaoId: 'versao-politica-1',
}

function requisito(
  overrides: Partial<RequisitoEsperadoAprovacao> = {},
): RequisitoEsperadoAprovacao {
  return {
    id: 'req-1',
    nome: 'Pedido de compra',
    tipoDocumento: 'nf_pedido_compra',
    escopo: 'nf_pre_cessao',
    obrigatorio: true,
    bloqueiaFluxo: true,
    momento: 'antes_cessao',
    regraValidade: 'manual',
    ativo: true,
    ...overrides,
  }
}

function instancia(
  overrides: Partial<InstanciaRequisitoAprovacao> = {},
): InstanciaRequisitoAprovacao {
  return {
    notaFiscalId: 'nf-1',
    requisitoId: 'req-1',
    politicaVersaoId: 'versao-politica-1',
    statusInstancia: 'pendente',
    documentoId: 'doc-1',
    versaoAprovadaId: null,
    versaoAtual: {
      id: 'versao-documento-1',
      status: 'em_analise',
      ultimaAnalise: null,
    },
    ...overrides,
  }
}

function avaliar(overrides: Partial<Parameters<typeof avaliarElegibilidadeDocumentalDaNota>[0]> = {}) {
  return avaliarElegibilidadeDocumentalDaNota({
    notaFiscalId: 'nf-1',
    politica: politicaResolvida,
    requisitosEsperados: [requisito()],
    instancias: [instancia()],
    arquivoOriginal: 'cedente/nf/nota.pdf',
    ...overrides,
  })
}

describe('gate documental canonico da aprovacao de NF', () => {
  it('considera nao aplicavel uma politica resolvida com zero requisitos pre-cessao', () => {
    expect(avaliar({ requisitosEsperados: [], instancias: [] })).toMatchObject({
      estado: 'nao_aplicavel',
      aplicavel: false,
      elegivel: true,
      totalEsperados: 0,
      requisitosPendentes: [],
    })
  })

  it('nao confunde politica inexistente com politica sem requisitos', () => {
    expect(avaliar({
      politica: { resolvida: false, fonte: null, politicaId: null, versaoId: null },
      requisitosEsperados: [],
      instancias: [],
    })).toMatchObject({
      estado: 'configuracao_invalida',
      elegivel: false,
    })
  })

  it('bloqueia e nomeia requisito obrigatorio esperado sem instancia', () => {
    expect(avaliar({ instancias: [] })).toMatchObject({
      estado: 'nao_instanciado',
      elegivel: false,
      ausentesMaterializacao: ['Pedido de compra'],
      requisitosPendentes: ['Pedido de compra'],
    })
  })

  it('bloqueia requisito real aguardando aprovacao', () => {
    expect(avaliar()).toMatchObject({
      estado: 'pendente',
      elegivel: false,
      requisitosEmAnalise: ['Pedido de compra'],
      totalObrigatorios: 1,
      pendentesObrigatorios: 1,
    })
  })

  it('bloqueia requisito real rejeitado', () => {
    expect(avaliar({
      instancias: [instancia({
        versaoAtual: {
          id: 'versao-documento-1',
          status: 'rejeitado',
          ultimaAnalise: { resultado: 'rejeitado' },
        },
      })],
    })).toMatchObject({
      estado: 'pendente',
      possuiRejeicao: true,
      requisitosRejeitados: ['Pedido de compra'],
    })
  })

  it('fica completo quando todos os obrigatorios estao aprovados', () => {
    expect(avaliar({
      instancias: [instancia({
        versaoAprovadaId: 'versao-documento-1',
        versaoAtual: {
          id: 'versao-documento-1',
          status: 'aprovado',
          ultimaAnalise: { resultado: 'aprovado' },
        },
      })],
    })).toMatchObject({
      estado: 'completo',
      elegivel: true,
      concluidosObrigatorios: 1,
      pendentesObrigatorios: 0,
    })
  })

  it('nao bloqueia requisito opcional ausente e nao bloqueante', () => {
    expect(avaliar({
      requisitosEsperados: [requisito({ obrigatorio: false, bloqueiaFluxo: false })],
      instancias: [],
    })).toMatchObject({
      estado: 'completo',
      elegivel: true,
      totalObrigatorios: 0,
    })
  })

  it('ignora requisito pos-cessao no gate pre-cessao', () => {
    expect(avaliar({
      requisitosEsperados: [requisito({ escopo: 'pos_cessao' })],
      instancias: [],
    })).toMatchObject({
      estado: 'nao_aplicavel',
      elegivel: true,
    })
  })

  it('aceita arquivo original PDF', () => {
    expect(arquivoOriginalDaNotaValido('cedente/nf/arquivo.PDF')).toBe(true)
  })

  it('aceita arquivo original XML', () => {
    expect(arquivoOriginalDaNotaValido('cedente/nf/arquivo.xml')).toBe(true)
  })

  it('bloqueia quando nao existe arquivo original', () => {
    expect(avaliar({ arquivoOriginal: null })).toMatchObject({
      estado: 'arquivo_original_ausente',
      arquivoOriginalValido: false,
      elegivel: false,
    })
  })

  it('bloqueia arquivo original com formato diferente de PDF ou XML', () => {
    expect(avaliar({ arquivoOriginal: 'cedente/nf/arquivo.txt' })).toMatchObject({
      estado: 'arquivo_original_ausente',
      arquivoOriginalValido: false,
    })
  })

  it('nao mistura instancia de outra versao da politica', () => {
    expect(avaliar({
      instancias: [instancia({ politicaVersaoId: 'versao-antiga' })],
    })).toMatchObject({
      estado: 'nao_instanciado',
      ausentesMaterializacao: ['Pedido de compra'],
    })
  })

  it('nao produz pendencia sintetica de checklist', () => {
    const resultado = avaliar({ requisitosEsperados: [], instancias: [] })
    expect(JSON.stringify(resultado)).not.toContain('Checklist documental')
  })
})
