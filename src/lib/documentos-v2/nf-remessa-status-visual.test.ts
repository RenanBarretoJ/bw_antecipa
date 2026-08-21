import { describe, expect, it } from 'vitest'
import { resolverStatusVisualNfRemessa, satisfazRequisitoNfRemessa } from './nf-remessa-status-visual'

describe('resolverStatusVisualNfRemessa (ticket de consolidacao da UI)', () => {
  it('opcional sem remessa -> nao_enviada (nunca pendente)', () => {
    expect(resolverStatusVisualNfRemessa({ obrigatorio: false, remessas: [] })).toBe('nao_enviada')
  })

  it('obrigatorio sem remessa -> pendente', () => {
    expect(resolverStatusVisualNfRemessa({ obrigatorio: true, remessas: [] })).toBe('pendente')
  })

  it('existe remessa VALIDADA -> validada, independente de obrigatorio', () => {
    expect(resolverStatusVisualNfRemessa({ obrigatorio: true, remessas: [{ status_validacao: 'VALIDADA' }] })).toBe('validada')
    expect(resolverStatusVisualNfRemessa({ obrigatorio: false, remessas: [{ status_validacao: 'VALIDADA' }] })).toBe('validada')
  })

  it('remessa REVISAO_MANUAL (sem VALIDADA) -> em_revisao', () => {
    expect(resolverStatusVisualNfRemessa({ obrigatorio: true, remessas: [{ status_validacao: 'REVISAO_MANUAL' }] })).toBe('em_revisao')
  })

  it('remessa REJEITADA (sem VALIDADA/REVISAO_MANUAL) -> rejeitada', () => {
    expect(resolverStatusVisualNfRemessa({ obrigatorio: true, remessas: [{ status_validacao: 'REJEITADA' }] })).toBe('rejeitada')
  })

  it('multiplas remessas: VALIDADA tem prioridade sobre REVISAO_MANUAL/REJEITADA', () => {
    expect(resolverStatusVisualNfRemessa({
      obrigatorio: true,
      remessas: [{ status_validacao: 'REJEITADA' }, { status_validacao: 'REVISAO_MANUAL' }, { status_validacao: 'VALIDADA' }],
    })).toBe('validada')
  })

  it('multiplas remessas: REVISAO_MANUAL tem prioridade sobre REJEITADA quando nao ha VALIDADA', () => {
    expect(resolverStatusVisualNfRemessa({
      obrigatorio: true,
      remessas: [{ status_validacao: 'REJEITADA' }, { status_validacao: 'REVISAO_MANUAL' }],
    })).toBe('em_revisao')
  })
})

describe('satisfazRequisitoNfRemessa', () => {
  it('so validada satisfaz o requisito obrigatorio', () => {
    expect(satisfazRequisitoNfRemessa('validada')).toBe(true)
    expect(satisfazRequisitoNfRemessa('pendente')).toBe(false)
    expect(satisfazRequisitoNfRemessa('nao_enviada')).toBe(false)
    expect(satisfazRequisitoNfRemessa('em_revisao')).toBe(false)
    expect(satisfazRequisitoNfRemessa('rejeitada')).toBe(false)
  })
})
