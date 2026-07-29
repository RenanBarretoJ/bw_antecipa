import { describe, expect, it } from 'vitest'
import { avaliarElegibilidadeAprovacaoNf } from './elegibilidade-aprovacao'

describe('avaliarElegibilidadeAprovacaoNf', () => {
  it('bloqueia aprovacao formal antes da submissao expressa do cedente', () => {
    const result = avaliarElegibilidadeAprovacaoNf({
      status: 'rascunho',
      documentos: {
        elegivel: true,
        requisitosPendentes: [],
        requisitosRejeitados: [],
        requisitosEmAnalise: [],
      },
    })

    expect(result.elegivel).toBe(false)
    expect(result.bloqueios.map((item) => item.codigo)).toContain('nf_nao_submetida')
  })

  it('bloqueia NF submetida com documento manual ainda aguardando aprovacao', () => {
    const result = avaliarElegibilidadeAprovacaoNf({
      status: 'submetida',
      documentos: {
        elegivel: false,
        requisitosPendentes: ['Pedido de Compra'],
        requisitosRejeitados: [],
        requisitosEmAnalise: ['Pedido de Compra'],
      },
    })

    expect(result.elegivel).toBe(false)
    expect(result.bloqueios).toEqual([expect.objectContaining({ codigo: 'documentos_nao_aprovados' })])
  })

  it('permite aprovacao da NF submetida com checklist documental aprovado', () => {
    const result = avaliarElegibilidadeAprovacaoNf({
      status: 'submetida',
      documentos: {
        elegivel: true,
        requisitosPendentes: [],
        requisitosRejeitados: [],
        requisitosEmAnalise: [],
      },
    })

    expect(result).toEqual({ elegivel: true, bloqueios: [] })
  })
})
