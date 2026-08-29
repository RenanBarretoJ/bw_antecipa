import { describe, expect, it } from 'vitest'
import { reconciliarDocumentosBaseComChecklist } from './reconciliacao'

const requisito = (codigo: string, id = codigo) => ({ id, codigo, tipoDocumentoCodigo: codigo, ativo: true })

describe('reconciliarDocumentosBaseComChecklist', () => {
  it('satisfaz XML e DANFE somente com evidencia persistida e aprovada', () => {
    const result = reconciliarDocumentosBaseComChecklist({
      requisitos: [requisito('nf_xml'), requisito('nf_danfe_pdf')],
      instancias: [
        { requisitoId: 'nf_xml', documentoId: 'doc-xml', versaoAprovadaId: 'ver-xml', status: 'satisfeito' },
        { requisitoId: 'nf_danfe_pdf', documentoId: 'doc-pdf', versaoAprovadaId: null, status: 'pendente', versoes: [{ status: 'em_analise' }] },
      ],
    })
    expect(result.instanciasSatisfeitas).toBe(1)
    expect(result.instanciasPendentes).toBe(1)
    expect(result.itens).toEqual([
      { requisitoId: 'nf_xml', codigo: 'nf_xml', status: 'satisfeito' },
      { requisitoId: 'nf_danfe_pdf', codigo: 'nf_danfe_pdf', status: 'enviado' },
    ])
  })

  it('mantem requisito sem documento como pendente e nao inventa DANFE a partir de XML', () => {
    const result = reconciliarDocumentosBaseComChecklist({
      requisitos: [requisito('nf_xml'), requisito('nf_danfe_pdf')],
      instancias: [{ requisitoId: 'nf_xml', documentoId: 'doc-xml', versaoAprovadaId: 'ver-xml', status: 'satisfeito' }, { requisitoId: 'nf_danfe_pdf', status: 'pendente' }],
    })
    expect(result.itens.map((item) => item.status)).toEqual(['satisfeito', 'pendente'])
  })

  it('classifica upload existente sem aprovacao como enviado, aguardando analise', () => {
    const result = reconciliarDocumentosBaseComChecklist({
      requisitos: [requisito('nf_xml')],
      instancias: [{ requisitoId: 'nf_xml', documentoId: 'doc-xml', status: 'pendente', versoes: [{ status: 'em_analise' }] }],
    })
    expect(result.itens[0].status).toBe('enviado')
  })

  it('classifica evidencia estrutural valida como satisfeita', () => {
    const result = reconciliarDocumentosBaseComChecklist({
      requisitos: [requisito('nf_xml')],
      instancias: [{ requisitoId: 'nf_xml', documentoId: 'doc-xml', nivelValidacao: 'estrutural', status: 'pendente', versoes: [{ status: 'em_analise' }] }],
    })
    expect(result.itens[0].status).toBe('satisfeito')
  })

  it('nao cria pendencias para politica que nao exige XML/DANFE', () => {
    const result = reconciliarDocumentosBaseComChecklist({
      requisitos: [requisito('nf_pedido_compra')],
      instancias: [],
    })
    expect(result.itens).toEqual([])
    expect(result.instanciasPendentes).toBe(0)
  })

  it('e idempotente na leitura da mesma instancia', () => {
    const input = {
      requisitos: [requisito('nf_xml')],
      instancias: [{ requisitoId: 'nf_xml', documentoId: 'doc-xml', versaoAprovadaId: 'ver-xml', status: 'satisfeito' }],
    }
    expect(reconciliarDocumentosBaseComChecklist(input)).toEqual(reconciliarDocumentosBaseComChecklist(input))
  })
})
