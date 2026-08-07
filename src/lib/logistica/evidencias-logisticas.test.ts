import { describe, expect, it } from 'vitest'
import {
  avaliarGateLogisticoPreCessao,
  classificarStatusLogisticoPreCessao,
  resolverFamiliaDocumentalLogistica,
  validarUnicidadeFamiliasLogisticas,
} from './evidencias-logisticas'

describe('familias documentais logisticas', () => {
  it.each([
    ['cte', 'cte'],
    ['cte_xml', 'cte'],
    ['cte_pdf_dacte', 'cte'],
    ['cte_dacte_pdf', 'cte'],
    ['dacte', 'cte'],
    ['canhoto', 'comprovante_entrega'],
    ['comprovante_entrega', 'comprovante_entrega'],
    ['comprovante_de_entrega', 'comprovante_entrega'],
  ] as const)('normaliza %s para %s', (codigo, familia) => {
    expect(resolverFamiliaDocumentalLogistica(codigo)).toBe(familia)
  })

  it('rejeita requisitos duplicados da mesma familia', () => {
    expect(() => validarUnicidadeFamiliasLogisticas([
      { codigo: 'cte_xml', tipo_documento_codigo: 'cte', ativo: true },
      { codigo: 'dacte', tipo_documento_codigo: 'cte', ativo: true },
    ])).toThrow(/mais de uma vez/)
  })
})

describe('classificacao logistica pre-cessao', () => {
  it('prioriza comprovante aprovado sobre CT-e aprovado', () => {
    const result = classificarStatusLogisticoPreCessao([
      { familia: 'cte', documentoId: 'doc-cte', versaoId: 'v1', versaoStatus: 'aprovado' },
      { familia: 'comprovante_entrega', documentoId: 'doc-entrega', versaoId: 'v2', versaoStatus: 'aprovado' },
    ])
    expect(result.status).toBe('ENTREGUE')
    expect(result.documentoId).toBe('doc-entrega')
  })

  it('classifica CT-e aprovado como em transito', () => {
    expect(classificarStatusLogisticoPreCessao([
      { familia: 'cte', documentoId: 'doc', versaoId: 'v1', versaoStatus: 'enviado', analiseResultado: 'aprovado' },
    ]).status).toBe('EM_TRANSITO')
  })

  it('ignora documentos pendentes, rejeitados e cancelados', () => {
    expect(classificarStatusLogisticoPreCessao([
      { familia: 'cte', documentoId: 'a', versaoId: 'v1', versaoStatus: 'enviado' },
      { familia: 'comprovante_entrega', documentoId: 'b', versaoId: 'v2', versaoStatus: 'rejeitado' },
    ]).status).toBe('INDETERMINADA')
  })

  it('preserva a ultima evidencia aprovada enquanto uma substituicao aguarda analise', () => {
    const result = classificarStatusLogisticoPreCessao([
      { familia: 'comprovante_entrega', documentoId: 'doc-v1', versaoId: 'v1', versaoStatus: 'aprovado', analisadoEm: '2026-08-01T10:00:00Z' },
      { familia: 'comprovante_entrega', documentoId: 'doc-v2', versaoId: 'v2', versaoStatus: 'em_analise', analisadoEm: '2026-08-02T10:00:00Z' },
      { familia: 'cte', documentoId: 'cte-v1', versaoId: 'v3', versaoStatus: 'aprovado', analisadoEm: '2026-08-03T10:00:00Z' },
    ])

    expect(result.status).toBe('ENTREGUE')
    expect(result.documentoId).toBe('doc-v1')
  })

  it.each(['EM_TRANSITO', 'ENTREGUE'] as const)('permite %s quando o gate esta ativo', (status) => {
    expect(avaliarGateLogisticoPreCessao({ exigirStatusLogistico: true, classificacao: { status } }).permitido).toBe(true)
  })

  it('mantem politica legada permissiva e bloqueia somente quando o gate esta ativo', () => {
    const classificacao = classificarStatusLogisticoPreCessao([])
    expect(avaliarGateLogisticoPreCessao({ exigirStatusLogistico: false, classificacao }).permitido).toBe(true)
    expect(avaliarGateLogisticoPreCessao({ exigirStatusLogistico: true, classificacao }).permitido).toBe(false)
  })
})
