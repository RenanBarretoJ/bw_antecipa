import { describe, expect, it } from 'vitest'
import {
  calcularCriticidadePrazoLogistico,
  construirLinhaAcompanhamentoLogistico,
  filtrarLinhasAcompanhamentoLogistico,
  ordenarLinhasAcompanhamentoLogistico,
  paginarAcompanhamentoLogistico,
  resolverAplicabilidadeLogistica,
  resolverAplicabilidadeLogisticaDosRequisitos,
  resolverEstadoInicialAcompanhamentoLogistico,
  resolverStatusDocumentoLogistico,
  resumirAcompanhamentoLogistico,
  type DocumentoLogisticoCompactoRaw,
  type LinhaAcompanhamentoLogistico,
} from './acompanhamento-operacao'

const HOJE = new Date('2026-08-03T12:00:00.000Z')
const snapshot = {
  cria_acompanhamento_entrega: true,
  requisitos: [
    { codigo: 'cte_xml', tipo_documento_codigo: 'cte_xml', escopo: 'entrega', obrigatorio: true, ativo: true },
    { codigo: 'comprovante_entrega', tipo_documento_codigo: 'comprovante_entrega', escopo: 'pos_cessao', obrigatorio: true, ativo: true },
  ],
}

function documento(overrides: Partial<DocumentoLogisticoCompactoRaw> = {}): DocumentoLogisticoCompactoRaw {
  return {
    codigo: 'cte_xml',
    obrigatorio: true,
    statusInstancia: 'pendente',
    statusDocumento: null,
    prazoLimite: '2026-08-10',
    atualizadoEm: null,
    ...overrides,
  }
}

function linha(overrides: Partial<LinhaAcompanhamentoLogistico> = {}): LinhaAcompanhamentoLogistico {
  const base = construirLinhaAcompanhamentoLogistico({
    notaFiscalId: 'nf-1',
    numeroNf: '100',
    entrega: {
      id: 'entrega-1',
      status: 'em_transito',
      dataLimiteCte: '2026-08-10',
      dataLimiteComprovante: '2026-08-11',
      entregaConfirmadaEm: null,
      motivoPendencia: null,
    },
    documentos: [],
    postergacao: null,
    aplicabilidade: resolverAplicabilidadeLogistica(snapshot),
    hoje: HOJE,
  })
  return { ...base, ...overrides }
}

describe('acompanhamento logistico por operacao', () => {
  it('oculta a capacidade quando o snapshot nao possui acompanhamento nem requisito logistico', () => {
    expect(resolverAplicabilidadeLogistica({ cria_acompanhamento_entrega: false, requisitos: [] })).toEqual({
      habilitada: false,
      cte: { aplicavel: false, obrigatorio: false },
      comprovanteEntrega: { aplicavel: false, obrigatorio: false },
    })
  })

  it('resolve as categorias exclusivamente pelo snapshot aplicavel', () => {
    const aplicabilidade = resolverAplicabilidadeLogistica(snapshot)
    expect(aplicabilidade).toMatchObject({
      habilitada: true,
      cte: { aplicavel: true, obrigatorio: true },
      comprovanteEntrega: { aplicavel: true, obrigatorio: true },
    })
  })

  it('resolve aplicabilidade por NF pelos requisitos materializados, sem herdar categoria de outra nota', () => {
    expect(resolverAplicabilidadeLogisticaDosRequisitos([
      documento({ codigo: 'comprovante_entrega', obrigatorio: true }),
    ])).toEqual({
      habilitada: true,
      cte: { aplicavel: false, obrigatorio: false },
      comprovanteEntrega: { aplicavel: true, obrigatorio: true },
    })
    expect(resolverAplicabilidadeLogisticaDosRequisitos([]).habilitada).toBe(false)
  })

  it('resolve oculto, aguardando desembolso e pronto sem inferencia da interface', () => {
    expect(resolverEstadoInicialAcompanhamentoLogistico({ aplicavel: false, desembolsada: false })).toBe('oculto')
    expect(resolverEstadoInicialAcompanhamentoLogistico({ aplicavel: true, desembolsada: false })).toBe('aguardando_desembolso')
    expect(resolverEstadoInicialAcompanhamentoLogistico({ aplicavel: true, desembolsada: true })).toBe('pronto')
  })

  it('nao transforma categoria nao aplicavel em pendencia', () => {
    const resumo = resolverStatusDocumentoLogistico({
      categoria: 'cte',
      aplicabilidade: { aplicavel: false, obrigatorio: false },
      documentos: [],
      prazoOriginal: '2026-08-01',
      hoje: HOJE,
    })
    expect(resumo.status).toBe('nao_exigido')
    expect(resumo.criticidadePrazo).toBe('sem_prazo')
  })

  it('prioriza rejeicao documental mesmo com prazo vencido', () => {
    const resumo = resolverStatusDocumentoLogistico({
      categoria: 'cte',
      aplicabilidade: { aplicavel: true, obrigatorio: true },
      documentos: [documento({ statusDocumento: 'rejeitado', prazoLimite: '2026-08-01' })],
      prazoOriginal: '2026-08-01',
      hoje: HOJE,
    })
    expect(resumo.status).toBe('rejeitado')
  })

  it('classifica prazo vencido, vencendo hoje e proximo', () => {
    expect(calcularCriticidadePrazoLogistico({ prazo: '2026-08-02', concluido: false, hoje: HOJE })).toBe('vencido')
    expect(calcularCriticidadePrazoLogistico({ prazo: '2026-08-03', concluido: false, hoje: HOJE })).toBe('vence_hoje')
    expect(calcularCriticidadePrazoLogistico({ prazo: '2026-08-05', concluido: false, hoje: HOJE })).toBe('proximo')
  })

  it('usa a nova previsao do comprovante sem apagar o prazo original', () => {
    const resultado = construirLinhaAcompanhamentoLogistico({
      notaFiscalId: 'nf-1',
      numeroNf: '100',
      entrega: { id: 'entrega-1', status: 'em_transito', dataLimiteCte: null, dataLimiteComprovante: '2026-08-02', entregaConfirmadaEm: null, motivoPendencia: null },
      documentos: [],
      postergacao: { prazoOriginal: '2026-08-02', novaPrevisao: '2026-08-07', comunicadaEm: '2026-08-01T12:00:00Z' },
      aplicabilidade: resolverAplicabilidadeLogistica({
        cria_acompanhamento_entrega: true,
        requisitos: [{ codigo: 'comprovante_entrega', escopo: 'entrega', obrigatorio: true, ativo: true }],
      }),
      hoje: HOJE,
    })
    expect(resultado.comprovanteEntrega).toMatchObject({ prazoOriginal: '2026-08-02', prazoEfetivo: '2026-08-07', novaPrevisao: '2026-08-07' })
    expect(resultado.comprovanteEntrega.criticidadePrazoOriginal).toBe('vencido')
    expect(resultado.status).toBe('prazo_vencido')
  })

  it('mostra preparacao quando a entrega ainda nao foi criada apos o desembolso', () => {
    const resultado = construirLinhaAcompanhamentoLogistico({
      notaFiscalId: 'nf-1',
      numeroNf: '100',
      entrega: null,
      documentos: [],
      postergacao: null,
      aplicabilidade: resolverAplicabilidadeLogistica(snapshot),
      hoje: HOJE,
    })
    expect(resultado.status).toBe('preparando')
  })

  it('conclui somente quando entrega e documentos obrigatorios estao concluidos', () => {
    const resultado = construirLinhaAcompanhamentoLogistico({
      notaFiscalId: 'nf-1',
      numeroNf: '100',
      entrega: { id: 'entrega-1', status: 'entregue', dataLimiteCte: '2026-08-10', dataLimiteComprovante: '2026-08-11', entregaConfirmadaEm: '2026-08-03T10:00:00Z', motivoPendencia: null },
      documentos: [
        documento({ codigo: 'cte_xml', statusInstancia: 'satisfeito', statusDocumento: 'aprovado' }),
        documento({ codigo: 'comprovante_entrega', statusInstancia: 'satisfeito', statusDocumento: 'aprovado' }),
      ],
      postergacao: null,
      aplicabilidade: resolverAplicabilidadeLogistica(snapshot),
      hoje: HOJE,
    })
    expect(resultado.status).toBe('concluido')
  })

  it('resume com prioridade atencao sobre andamento e conclusao', () => {
    const resumo = resumirAcompanhamentoLogistico([
      linha({ notaFiscalId: 'nf-1', status: 'concluido' }),
      linha({ notaFiscalId: 'nf-2', status: 'em_analise' }),
      linha({ notaFiscalId: 'nf-3', status: 'prazo_vencido' }),
    ])
    expect(resumo).toMatchObject({ statusGeral: 'atencao', total: 3, concluidas: 1, emAnalise: 1, atencao: 1, pendentes: 0, percentualConclusao: 33 })
  })

  it('mantem opcional ausente fora das pendencias e conclui quando o obrigatorio foi aprovado', () => {
    const resultado = construirLinhaAcompanhamentoLogistico({
      notaFiscalId: 'nf-1',
      numeroNf: '100',
      entrega: { id: 'entrega-1', status: 'entregue', dataLimiteCte: null, dataLimiteComprovante: null, entregaConfirmadaEm: '2026-08-03T10:00:00Z', motivoPendencia: null },
      documentos: [documento({ codigo: 'cte_xml', statusInstancia: 'satisfeito', statusDocumento: 'aprovado' })],
      postergacao: null,
      aplicabilidade: resolverAplicabilidadeLogistica({
        cria_acompanhamento_entrega: true,
        requisitos: [
          { codigo: 'cte_xml', escopo: 'entrega', obrigatorio: true, ativo: true },
          { codigo: 'comprovante_entrega', escopo: 'entrega', obrigatorio: false, ativo: true },
        ],
      }),
      hoje: HOJE,
    })
    expect(resultado.comprovanteEntrega).toMatchObject({ obrigatorio: false, status: 'aguardando_upload' })
    expect(resultado.status).toBe('concluido')
  })

  it('resume operacao totalmente concluida e operacao sem nenhuma NF concluida', () => {
    expect(resumirAcompanhamentoLogistico([linha({ status: 'concluido' }), linha({ status: 'concluido' })])).toMatchObject({
      statusGeral: 'concluido', concluidas: 2, percentualConclusao: 100,
    })
    expect(resumirAcompanhamentoLogistico([linha({ status: 'aguardando_upload' }), linha({ status: 'em_andamento' })])).toMatchObject({
      statusGeral: 'em_andamento', concluidas: 0, pendentes: 2, percentualConclusao: 0,
    })
  })

  it('limita o resumo inicial a 5 NFs e pagina a visao expandida em blocos de 10', () => {
    const linhas = Array.from({ length: 23 }, (_, index) => linha({ notaFiscalId: `nf-${index + 1}`, numeroNf: String(index + 1) }))
    expect(paginarAcompanhamentoLogistico(linhas, { expandido: false, pagina: 1 }).linhas).toHaveLength(5)
    const paginaDois = paginarAcompanhamentoLogistico(linhas, { expandido: true, pagina: 2 })
    expect(paginaDois).toMatchObject({ pagina: 2, totalPaginas: 3 })
    expect(paginaDois.linhas).toHaveLength(10)
    expect(paginaDois.linhas[0].notaFiscalId).toBe('nf-11')
  })

  it('ordena por criticidade e permite filtro e busca por NF', () => {
    const linhas = [
      linha({ notaFiscalId: 'nf-2', numeroNf: '200', status: 'concluido' }),
      linha({ notaFiscalId: 'nf-1', numeroNf: '100', status: 'rejeitado' }),
      linha({ notaFiscalId: 'nf-3', numeroNf: '300', status: 'em_analise' }),
    ]
    expect(ordenarLinhasAcompanhamentoLogistico(linhas).map((item) => item.numeroNf)).toEqual(['100', '300', '200'])
    expect(filtrarLinhasAcompanhamentoLogistico(linhas, 'em_analise', '300')).toHaveLength(1)
    expect(filtrarLinhasAcompanhamentoLogistico(linhas, 'concluidos', '')[0].numeroNf).toBe('200')
  })
})
