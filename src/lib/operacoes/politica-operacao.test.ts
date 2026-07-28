import { describe, expect, it } from 'vitest'
import { construirEtapasOperacao, construirPendenciasOperacao, normalizarSnapshotPoliticaOperacao, obterCapacidadesOperacao } from './politica-operacao'

const baseOperation = {
  status: 'em_andamento',
  created_at: '2026-07-28T10:00:00Z',
  cessao_efetivada_em: '2026-07-28T11:00:00Z',
  aceite_sacado_exigido: false,
  aceite_sacado_status: 'dispensado',
  conta_escrow_id: null,
  politica_snapshot: {
    schema: 'bw-antecipa.politica-operacional.v1',
    aceite_sacado_obrigatorio: false,
    cria_acompanhamento_entrega: false,
    requisitos: [
      { codigo: 'nf_xml', tipo_documento_codigo: 'nf_xml', escopo: 'nf_pre_cessao', obrigatorio: true, ativo: true },
    ],
    configuracao: {},
  },
}

describe('capacidades da operação derivadas do snapshot', () => {
  it('oculta logística quando a política não a habilita', () => {
    const capabilities = obterCapacidadesOperacao(baseOperation)
    const etapas = construirEtapasOperacao({ operacao: baseOperation, capacidades: capabilities, documentos: [], logistica: [{ status_entrega: 'em_transito' }] })

    expect(capabilities.usaAcompanhamentoLogistico).toBe(false)
    expect(etapas.some((item) => item.id === 'entrega_acompanhamento')).toBe(false)
    expect(etapas.some((item) => item.id === 'cte')).toBe(false)
  })

  it('mostra somente os módulos documentais logísticos presentes no snapshot', () => {
    const operation = {
      ...baseOperation,
      politica_snapshot: {
        ...baseOperation.politica_snapshot,
        cria_acompanhamento_entrega: true,
        requisitos: [
          { codigo: 'cte', tipo_documento_codigo: 'cte', escopo: 'entrega', obrigatorio: true, ativo: true },
          { codigo: 'canhoto', tipo_documento_codigo: 'canhoto', escopo: 'entrega', obrigatorio: false, ativo: true },
        ],
      },
    }
    const capabilities = obterCapacidadesOperacao(operation)
    const etapas = construirEtapasOperacao({ operacao: operation, capacidades: capabilities, documentos: [], logistica: [] })

    expect(capabilities.exigeCteXml).toBe(true)
    expect(capabilities.exigeCanhoto).toBe(false)
    expect(etapas.map((item) => item.id)).toContain('cte')
    expect(etapas.map((item) => item.id)).not.toContain('comprovante_entrega')
  })

  it('usa fallback conservador para snapshot antigo', () => {
    const normalized = normalizarSnapshotPoliticaOperacao({ aceite_sacado_obrigatorio: true })
    const capabilities = obterCapacidadesOperacao({ ...baseOperation, politica_snapshot: { aceite_sacado_obrigatorio: true } })

    expect(normalized.avisos).toContain('requisitos_ausentes_no_snapshot')
    expect(capabilities.usaAcompanhamentoLogistico).toBe(false)
    expect(capabilities.exigeCteXml).toBe(false)
  })

  it('não cria pendência logística quando o módulo não é aplicável', () => {
    const capabilities = obterCapacidadesOperacao(baseOperation)
    const pending = construirPendenciasOperacao({
      capacidades: capabilities,
      documentos: [
        { id: 'cte-1', tipo_documento_codigo_snapshot: 'cte', escopo_snapshot: 'entrega', status: 'pendente', obrigatorio: true, responsavel_upload_snapshot: 'cedente' },
        { id: 'nf-1', tipo_documento_codigo_snapshot: 'nf_xml', escopo_snapshot: 'nf_pre_cessao', status: 'pendente', obrigatorio: true, responsavel_upload_snapshot: 'cedente' },
      ],
    })

    expect(pending.map((item) => item.id)).toEqual(['nf-1'])
  })

  it('nao exibe a etapa de conta escrow no andamento da operacao', () => {
    const operation = { ...baseOperation, conta_escrow_id: 'escrow-1' }
    const capabilities = obterCapacidadesOperacao(operation)
    const etapas = construirEtapasOperacao({ operacao: operation, capacidades: capabilities, documentos: [], logistica: [] })

    expect(capabilities.usaEscrow).toBe(true)
    expect(etapas.some((item) => item.id === 'escrow')).toBe(false)
    expect(etapas.some((item) => item.id === 'pagamento')).toBe(true)
  })
})
