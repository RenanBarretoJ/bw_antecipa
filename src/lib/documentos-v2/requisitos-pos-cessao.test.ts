import { describe, expect, it } from 'vitest'
import { faseDocumentalPorEscopo, requisitosPosCessaoDoSnapshot } from './requisitos-pos-cessao'
import type { RequisitoDocumentalSnapshot } from './requisitos-pos-cessao'

const req = (codigo: string, escopo: string, ativo = true): RequisitoDocumentalSnapshot => ({
  codigo,
  escopo,
  tipo_documento_codigo: codigo,
  obrigatorio: true,
  quantidade_minima: 1,
  formatos_aceitos: ['pdf'],
  nivel_validacao: 'manual',
  prazo_dias_corridos: 10,
  responsavel_upload: 'cedente',
  responsavel_aprovacao: 'gestor',
  ordem: 1,
  ativo,
})

describe('requisitos documentais por escopo do snapshot', () => {
  it('nao classifica CT-e pre-cessao como pos-cessao', () => {
    const requisitos = [
      req('nf_xml', 'nf_pre_cessao'),
      req('nf_danfe_pdf', 'nf_pre_cessao'),
      req('nf_pedido_compra', 'nf_pre_cessao'),
      req('cte', 'nf_pre_cessao'),
      req('comprovante_entrega', 'pos_cessao'),
    ]

    expect(requisitosPosCessaoDoSnapshot(requisitos).map((item) => item.codigo)).toEqual(['comprovante_entrega'])
  })

  it('cria CT-e quando ele estiver explicitamente no escopo pos-cessao', () => {
    expect(requisitosPosCessaoDoSnapshot([
      req('cte', 'pos_cessao'),
      req('nf_xml', 'nf_pre_cessao'),
    ]).map((item) => item.codigo)).toEqual(['cte'])
  })

  it('nao inventa comprovante quando acompanhamento existe mas nao ha requisito ativo', () => {
    expect(requisitosPosCessaoDoSnapshot([
      req('nf_xml', 'nf_pre_cessao'),
      req('comprovante_entrega', 'pos_cessao', false),
    ])).toEqual([])
  })

  it('classifica a fase pelo escopo persistido, nao pelo vinculo tecnico de entrega', () => {
    expect(faseDocumentalPorEscopo('nf_pre_cessao')).toBe('pre_cessao')
    expect(faseDocumentalPorEscopo('pos_cessao')).toBe('pos_cessao')
    expect(faseDocumentalPorEscopo('entrega')).toBe('pos_cessao')
  })
})
