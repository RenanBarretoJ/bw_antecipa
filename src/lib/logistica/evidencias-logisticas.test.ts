import { describe, expect, it } from 'vitest'
import {
  avaliarGateLogisticoPreCessao,
  avaliarSubmissaoLogisticaPreCessao,
  classificarStatusLogisticoPreCessao,
  evidenciasDoChecklistRegular,
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

describe('gate logistico de SUBMISSAO (cedente) -- diferente do gate de aprovacao (gestor)', () => {
  // Regra do P0: submissao exige apenas evidencia VIGENTE (enviada, em
  // analise ou aprovada), nao aprovada -- diferente de
  // classificarStatusLogisticoPreCessao (usado no rotulo de exibicao e no
  // gate de aprovacao do gestor), que so considera evidencia aprovada.

  it('DENY quando nao ha nenhuma evidencia', () => {
    expect(avaliarSubmissaoLogisticaPreCessao({ exigido: true, evidencias: [] }).permitido).toBe(false)
  })

  it('ALLOW com CT-e enviado aguardando analise', () => {
    expect(avaliarSubmissaoLogisticaPreCessao({
      exigido: true,
      evidencias: [{ familia: 'cte', documentoId: 'doc', versaoId: 'v1', versaoStatus: 'enviado', criadoEm: '2026-08-01' }],
    }).permitido).toBe(true)
  })

  it('ALLOW com Comprovante de Entrega enviado aguardando analise', () => {
    expect(avaliarSubmissaoLogisticaPreCessao({
      exigido: true,
      evidencias: [{ familia: 'comprovante_entrega', documentoId: 'doc', versaoId: 'v1', versaoStatus: 'em_analise', criadoEm: '2026-08-01' }],
    }).permitido).toBe(true)
  })

  it('ALLOW quando ja aprovado (aprovado tambem satisfaz a submissao)', () => {
    expect(avaliarSubmissaoLogisticaPreCessao({
      exigido: true,
      evidencias: [{ familia: 'cte', documentoId: 'doc', versaoId: 'v1', versaoStatus: 'aprovado', criadoEm: '2026-08-01' }],
    }).permitido).toBe(true)
  })

  it('DENY quando a versao mais recente foi rejeitada e nao ha reenvio', () => {
    expect(avaliarSubmissaoLogisticaPreCessao({
      exigido: true,
      evidencias: [{ familia: 'cte', documentoId: 'doc', versaoId: 'v1', versaoStatus: 'rejeitado', criadoEm: '2026-08-01' }],
    }).permitido).toBe(false)
  })

  it('ALLOW quando a rejeicao antiga foi seguida de um reenvio vigente (usa a mais recente por upload, nao por analise)', () => {
    expect(avaliarSubmissaoLogisticaPreCessao({
      exigido: true,
      evidencias: [
        { familia: 'cte', documentoId: 'doc-v1', versaoId: 'v1', versaoStatus: 'rejeitado', analiseResultado: 'rejeitado', analisadoEm: '2026-08-01', criadoEm: '2026-08-01' },
        { familia: 'cte', documentoId: 'doc-v2', versaoId: 'v2', versaoStatus: 'em_analise', criadoEm: '2026-08-05' },
      ],
    }).permitido).toBe(true)
  })

  it('DENY quando a unica evidencia foi cancelada/substituida sem versao atual valida', () => {
    expect(avaliarSubmissaoLogisticaPreCessao({
      exigido: true,
      evidencias: [{ familia: 'comprovante_entrega', documentoId: 'doc', versaoId: 'v1', versaoStatus: 'cancelado', criadoEm: '2026-08-01' }],
    }).permitido).toBe(false)
  })

  it('nao exige nada quando o gate nao esta ativo', () => {
    expect(avaliarSubmissaoLogisticaPreCessao({ exigido: false, evidencias: [] }).permitido).toBe(true)
  })

  it('preserva a alternativa CT-e OU Comprovante de Entrega', () => {
    expect(avaliarSubmissaoLogisticaPreCessao({
      exigido: true,
      evidencias: [
        { familia: 'cte', documentoId: 'a', versaoId: 'v1', versaoStatus: 'rejeitado', criadoEm: '2026-08-01' },
        { familia: 'comprovante_entrega', documentoId: 'b', versaoId: 'v2', versaoStatus: 'enviado', criadoEm: '2026-08-01' },
      ],
    }).permitido).toBe(true)
  })
})

describe('evidenciasDoChecklistRegular -- CT-e/Comprovante enviados pelo checklist normal, nao pelo envio antecipado', () => {
  // Regressao real (NF-56 em homolog): CT-e anexado e "Aguardando analise"
  // no checklist normal continuava bloqueando a submissao porque o gate so
  // reconhecia evidencia_logistica_antecipada. Esta funcao converte o item
  // do checklist regular no mesmo formato de evidencia usado pelo gate.

  it('inclui item CT-e nf_pre_cessao com suas versoes', () => {
    const resultado = evidenciasDoChecklistRegular([
      {
        escopo: 'nf_pre_cessao',
        familiaDocumental: 'cte',
        documentoId: 'doc-cte',
        versoes: [{ id: 'v1', status: 'em_analise', criadoEm: '2026-08-20', ultimaAnalise: null }],
      },
    ])
    expect(resultado).toEqual([{
      familia: 'cte',
      documentoId: 'doc-cte',
      versaoId: 'v1',
      versaoStatus: 'em_analise',
      analiseResultado: null,
      analisadoEm: null,
      analisadoPor: null,
      criadoEm: '2026-08-20',
    }])
  })

  it('ignora comprovante_entrega pos_cessao (fora do gate pre-cessao)', () => {
    const resultado = evidenciasDoChecklistRegular([
      {
        escopo: 'pos_cessao',
        familiaDocumental: 'comprovante_entrega',
        documentoId: 'doc-canhoto',
        versoes: [{ id: 'v1', status: 'em_analise', criadoEm: '2026-08-20', ultimaAnalise: null }],
      },
    ])
    expect(resultado).toEqual([])
  })

  it('ignora itens sem familia documental logistica (ex.: nf_xml, boleto)', () => {
    const resultado = evidenciasDoChecklistRegular([
      { escopo: 'nf_pre_cessao', familiaDocumental: null, documentoId: 'doc-xml', versoes: [{ id: 'v1', status: 'em_analise', criadoEm: '2026-08-20', ultimaAnalise: null }] },
    ])
    expect(resultado).toEqual([])
  })

  it('propaga o resultado da analise mais recente quando existir', () => {
    const resultado = evidenciasDoChecklistRegular([
      {
        escopo: 'nf_pre_cessao',
        familiaDocumental: 'cte',
        documentoId: 'doc-cte',
        versoes: [{ id: 'v1', status: 'rejeitado', criadoEm: '2026-08-20', ultimaAnalise: { resultado: 'rejeitado', analisadoEm: '2026-08-21', analisadoPorId: 'gestor-1' } }],
      },
    ])
    expect(resultado[0]).toMatchObject({ analiseResultado: 'rejeitado', analisadoEm: '2026-08-21', analisadoPor: 'gestor-1' })
  })

  it('ponta a ponta: CT-e do checklist regular, sem nenhuma evidencia antecipada, permite a submissao', () => {
    const evidenciaDoChecklist = evidenciasDoChecklistRegular([
      {
        escopo: 'nf_pre_cessao',
        familiaDocumental: 'cte',
        documentoId: 'doc-cte-nf56',
        versoes: [{ id: 'v1', status: 'em_analise', criadoEm: '2026-08-20', ultimaAnalise: null }],
      },
    ])
    expect(avaliarSubmissaoLogisticaPreCessao({ exigido: true, evidencias: evidenciaDoChecklist }).permitido).toBe(true)
  })
})
