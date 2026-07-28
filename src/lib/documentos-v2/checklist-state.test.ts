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
  versoes: [],
})

describe('resolverEstadoChecklistDocumental', () => {
  it('trata politica com apenas XML e DANFE como nao aplicavel', () => {
    const result = resolverEstadoChecklistDocumental({
      politicaSnapshot: true,
      requisitosAplicaveis: [requisito('nf_xml'), requisito('nf_danfe_pdf')],
      instancias: [],
    })

    expect(result.estado).toBe('nao_aplicavel')
    expect(result.deveExibirCard).toBe(false)
    expect(result.deveExibirAlerta).toBe(false)
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
