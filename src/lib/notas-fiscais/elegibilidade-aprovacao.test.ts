import { describe, expect, it } from 'vitest'
import { avaliarElegibilidadeAprovacaoNf } from './elegibilidade-aprovacao'

function documentos(overrides: Partial<Parameters<typeof avaliarElegibilidadeAprovacaoNf>[0]['documentos']> = {}) {
  return {
    elegivel: true,
    estado: 'completo' as const,
    requisitosPendentes: [],
    requisitosRejeitados: [],
    requisitosEmAnalise: [],
    ausentesMaterializacao: [],
    ...overrides,
  }
}

describe('avaliarElegibilidadeAprovacaoNf', () => {
  it('bloqueia aprovacao formal antes da submissao expressa do cedente', () => {
    const result = avaliarElegibilidadeAprovacaoNf({
      status: 'rascunho',
      documentos: documentos(),
    })

    expect(result.elegivel).toBe(false)
    expect(result.bloqueios.map((item) => item.codigo)).toContain('nf_nao_submetida')
  })

  it('bloqueia NF submetida com requisito real aguardando aprovacao', () => {
    const result = avaliarElegibilidadeAprovacaoNf({
      status: 'submetida',
      documentos: documentos({
        elegivel: false,
        estado: 'pendente',
        requisitosPendentes: ['Pedido de compra'],
        requisitosEmAnalise: ['Pedido de compra'],
      }),
    })

    expect(result.bloqueios).toEqual([expect.objectContaining({
      codigo: 'documentos_nao_aprovados',
      mensagem: expect.stringContaining('Pedido de compra'),
    })])
  })

  it('distingue falha de materializacao e lista o requisito real', () => {
    const result = avaliarElegibilidadeAprovacaoNf({
      status: 'submetida',
      documentos: documentos({
        elegivel: false,
        estado: 'nao_instanciado',
        requisitosPendentes: ['XML da NF-e'],
        ausentesMaterializacao: ['XML da NF-e'],
      }),
    })

    expect(result.bloqueios).toEqual([expect.objectContaining({
      codigo: 'requisitos_nao_instanciados',
      mensagem: expect.stringContaining('XML da NF-e'),
    })])
  })

  it('bloqueia politica nao resolvida como erro de configuracao', () => {
    const result = avaliarElegibilidadeAprovacaoNf({
      status: 'submetida',
      documentos: documentos({ elegivel: false, estado: 'configuracao_invalida' }),
    })

    expect(result.bloqueios[0]?.codigo).toBe('politica_documental_nao_resolvida')
  })

  it('bloqueia ausencia de PDF ou XML separadamente do checklist', () => {
    const result = avaliarElegibilidadeAprovacaoNf({
      status: 'submetida',
      documentos: documentos({ elegivel: false, estado: 'arquivo_original_ausente' }),
    })

    expect(result.bloqueios).toEqual([{
      codigo: 'arquivo_original_ausente',
      mensagem: 'A NF nao possui arquivo original PDF ou XML valido.',
    }])
  })

  it('permite aprovacao da NF submetida sem requisitos aplicaveis', () => {
    const result = avaliarElegibilidadeAprovacaoNf({
      status: 'submetida',
      documentos: documentos({ estado: 'nao_aplicavel' }),
    })

    expect(result).toEqual({ elegivel: true, bloqueios: [] })
  })
})
