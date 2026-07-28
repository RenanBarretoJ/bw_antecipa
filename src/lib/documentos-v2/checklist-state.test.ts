import { describe, expect, it } from 'vitest'
import { resolverEstadoChecklistDocumental } from './checklist-state'

const requisito = (codigo: string, id = codigo, obrigatorio = true) => ({
  id,
  codigo,
  tipoDocumentoCodigo: codigo,
  escopo: 'nf_pre_cessao',
  obrigatorio,
  ativo: true,
})

const instancia = (requisitoId: string, status = 'pendente') => ({
  requisitoId,
  codigo: requisitoId,
  obrigatorio: true,
  status,
  versaoAprovadaId: status === 'satisfeito' ? 'versao-aprovada' : null,
  documentoId: status === 'satisfeito' ? 'documento-base' : null,
  versoes: [],
})

describe('resolverEstadoChecklistDocumental', () => {
  it('mantem XML e DANFE pendentes quando ainda nao existe evidencia', () => {
    const result = resolverEstadoChecklistDocumental({
      politicaSnapshot: true,
      requisitosAplicaveis: [requisito('nf_xml'), requisito('nf_danfe_pdf')],
      instancias: [],
    })

    expect(result.estado).toBe('nao_instanciado')
    expect(result.requisitosAplicaveis.map((item) => item.codigo)).toEqual(['nf_xml', 'nf_danfe_pdf'])
    expect(result.deveExibirCard).toBe(true)
    expect(result.deveExibirAlerta).toBe(true)
  })

  it('oculta XML e DANFE somente depois da reconciliacao', () => {
    const result = resolverEstadoChecklistDocumental({
      politicaSnapshot: true,
      requisitosAplicaveis: [requisito('nf_xml'), requisito('nf_danfe_pdf'), requisito('pedido_compra')],
      instancias: [
        instancia('nf_xml', 'satisfeito'),
        instancia('nf_danfe_pdf', 'satisfeito'),
        instancia('pedido_compra', 'pendente'),
      ],
    })

    expect(result.requisitosAplicaveis.map((item) => item.codigo)).toEqual(['pedido_compra'])
    expect(result.estado).toBe('pendente')
  })

  it('nao considera base satisfeita quando a instancia nao possui documento', () => {
    const result = resolverEstadoChecklistDocumental({
      politicaSnapshot: true,
      requisitosAplicaveis: [requisito('nf_xml')],
      instancias: [{ ...instancia('nf_xml', 'satisfeito'), documentoId: null }],
    })

    expect(result.estado).toBe('pendente')
    expect(result.pendentes).toBe(1)
    expect(result.deveExibirCard).toBe(true)
  })

  it('identifica requisito aplicavel sem instancia', () => {
    const result = resolverEstadoChecklistDocumental({
      politicaSnapshot: true,
      requisitosAplicaveis: [requisito('pedido_compra')],
      instancias: [],
    })

    expect(result.estado).toBe('nao_instanciado')
    expect(result.deveExibirAlerta).toBe(true)
  })

  it('identifica requisito pendente e concluido', () => {
    expect(resolverEstadoChecklistDocumental({
      politicaSnapshot: true,
      requisitosAplicaveis: [requisito('pedido_compra')],
      instancias: [instancia('pedido_compra')],
    }).estado).toBe('pendente')

    expect(resolverEstadoChecklistDocumental({
      politicaSnapshot: true,
      requisitosAplicaveis: [requisito('pedido_compra')],
      instancias: [instancia('pedido_compra', 'satisfeito')],
    }).estado).toBe('completo')
  })

  it('distingue ausencia de politica', () => {
    const result = resolverEstadoChecklistDocumental({
      politicaSnapshot: false,
      requisitosAplicaveis: [],
      instancias: [],
    })

    expect(result.estado).toBe('sem_politica')
    expect(result.deveExibirCard).toBe(false)
  })
})
