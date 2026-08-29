import { describe, expect, it } from 'vitest'
import { avaliarEstadoOperacional, validarElegibilidadeSolicitacao, type EstadoOperacional } from './elegibilidade'

function estado(overrides: Partial<EstadoOperacional> = {}): EstadoOperacional {
  return {
    operacao_id: 'op-1',
    status_operacao: 'solicitada',
    cedente_id: 'ced-1',
    aceite_exigido: true,
    aceite_status: 'pendente',
    legado: false,
    contexto_valido: true,
    snapshot_consistente: true,
    nfs: [{ id: 'nf-1', numero_nf: '10', cedente_id: 'ced-1', status: 'aceita', valor_bruto: 100, valor_liquido: null, data_vencimento: '2026-08-01' }],
    ...overrides,
  }
}

describe('gates de roteamento operacional', () => {
  it('bloqueia aprovação enquanto o aceite obrigatório está pendente', () => {
    const gate = avaliarEstadoOperacional(estado({ nfs: [{ ...estado().nfs[0], status: 'em_antecipacao' }] }))
    expect(gate.elegivel).toBe(false)
    expect(gate.bloqueios.join(' ')).toContain('aceite')
  })

  it('permite operação com aceite aceito e NFs aceitas', () => {
    const gate = avaliarEstadoOperacional(estado({ aceite_status: 'aceito' }))
    expect(gate.elegivel).toBe(true)
  })

  it('permite operação dispensada sem exigir status aceita na NF', () => {
    const gate = avaliarEstadoOperacional(estado({ aceite_exigido: false, aceite_status: 'dispensado', nfs: [{ ...estado().nfs[0], status: 'em_antecipacao' }] }))
    expect(gate.elegivel).toBe(true)
  })

  it('aplica fallback obrigatório para operação legada', () => {
    const gate = avaliarEstadoOperacional(estado({ legado: true, aceite_exigido: true, aceite_status: 'pendente' }))
    expect(gate.elegivel).toBe(false)
    expect(gate.avisos.join(' ')).toContain('fallback legado')
  })

  it('rejeita snapshot divergente na solicitação', () => {
    const gate = validarElegibilidadeSolicitacao({
      snapshot: { aceite_sacado_obrigatorio: false },
      politicaOperacionalVersaoId: 'version-1',
      aceiteSacadoObrigatorio: true,
      quantidadeNfs: 1,
    })
    expect(gate.elegivel).toBe(false)
    expect(gate.bloqueios.join(' ')).toContain('snapshot')
  })
})
