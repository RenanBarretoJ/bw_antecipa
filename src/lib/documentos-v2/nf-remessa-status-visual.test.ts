import { describe, expect, it } from 'vitest'
import {
  resolverLabelEnvioNfRemessa,
  resolverRemessaDestacada,
  resolverStatusVisualNfRemessa,
  satisfazRequisitoNfRemessa,
} from './nf-remessa-status-visual'

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

describe('resolverStatusVisualNfRemessa (separacao matching/aprovacao documental)', () => {
  it('VALIDADA com aprovacao_documental nulo (politica estrutural/sem requisito) -> validada', () => {
    expect(resolverStatusVisualNfRemessa({
      obrigatorio: true,
      remessas: [{ status_validacao: 'VALIDADA', aprovacao_documental: null }],
    })).toBe('validada')
  })

  it('VALIDADA com aprovacao_documental="aprovado" -> validada', () => {
    expect(resolverStatusVisualNfRemessa({
      obrigatorio: true,
      remessas: [{ status_validacao: 'VALIDADA', aprovacao_documental: 'aprovado' }],
    })).toBe('validada')
  })

  it('unica remessa VALIDADA aguardando analise documental, obrigatorio -> aguardando_analise', () => {
    expect(resolverStatusVisualNfRemessa({
      obrigatorio: true,
      remessas: [{ status_validacao: 'VALIDADA', aprovacao_documental: 'aguardando_analise' }],
    })).toBe('aguardando_analise')
  })

  it('unica remessa VALIDADA aguardando analise documental, opcional -> aguardando_analise (nao cai para nao_enviada)', () => {
    expect(resolverStatusVisualNfRemessa({
      obrigatorio: false,
      remessas: [{ status_validacao: 'VALIDADA', aprovacao_documental: 'aguardando_analise' }],
    })).toBe('aguardando_analise')
  })

  it('VALIDADA rejeitada na aprovacao documental -> rejeitada (mesmo com matching VALIDADA)', () => {
    expect(resolverStatusVisualNfRemessa({
      obrigatorio: true,
      remessas: [{ status_validacao: 'VALIDADA', aprovacao_documental: 'rejeitado' }],
    })).toBe('rejeitada')
  })

  it('mixed: uma aguardando_analise + uma aprovada/validada -> validada (aprovada outranca aguardando)', () => {
    expect(resolverStatusVisualNfRemessa({
      obrigatorio: true,
      remessas: [
        { status_validacao: 'VALIDADA', aprovacao_documental: 'aguardando_analise' },
        { status_validacao: 'VALIDADA', aprovacao_documental: 'aprovado' },
      ],
    })).toBe('validada')
  })

  it('mixed: uma aguardando_analise + uma REJEITADA de matching -> aguardando_analise (outranca rejeicao de matching)', () => {
    expect(resolverStatusVisualNfRemessa({
      obrigatorio: true,
      remessas: [
        { status_validacao: 'VALIDADA', aprovacao_documental: 'aguardando_analise' },
        { status_validacao: 'REJEITADA' },
      ],
    })).toBe('aguardando_analise')
  })

  it('mixed: rejeicao documental (VALIDADA) + REVISAO_MANUAL -> rejeitada (rejeicao documental outranca em_revisao)', () => {
    expect(resolverStatusVisualNfRemessa({
      obrigatorio: true,
      remessas: [
        { status_validacao: 'VALIDADA', aprovacao_documental: 'rejeitado' },
        { status_validacao: 'REVISAO_MANUAL' },
      ],
    })).toBe('rejeitada')
  })
})

describe('satisfazRequisitoNfRemessa', () => {
  it('so validada satisfaz o requisito obrigatorio', () => {
    expect(satisfazRequisitoNfRemessa('validada')).toBe(true)
    expect(satisfazRequisitoNfRemessa('pendente')).toBe(false)
    expect(satisfazRequisitoNfRemessa('nao_enviada')).toBe(false)
    expect(satisfazRequisitoNfRemessa('aguardando_analise')).toBe(false)
    expect(satisfazRequisitoNfRemessa('em_revisao')).toBe(false)
    expect(satisfazRequisitoNfRemessa('rejeitada')).toBe(false)
  })
})

describe('resolverRemessaDestacada', () => {
  it('sem remessas -> null', () => {
    expect(resolverRemessaDestacada([])).toBeNull()
  })

  it('uma VALIDADA com aprovacao nula (politica automatica) -> ela mesma', () => {
    const remessa = { id: 'a', status_validacao: 'VALIDADA' as const, aprovacao_documental: null }
    expect(resolverRemessaDestacada([remessa])).toBe(remessa)
  })

  it('uma VALIDADA aprovada tem prioridade sobre uma VALIDADA aguardando analise mais recente', () => {
    const aguardando = { id: 'recente', status_validacao: 'VALIDADA' as const, aprovacao_documental: 'aguardando_analise' as const }
    const aprovada = { id: 'antiga', status_validacao: 'VALIDADA' as const, aprovacao_documental: 'aprovado' as const }
    expect(resolverRemessaDestacada([aguardando, aprovada])).toBe(aprovada)
  })

  it('sem nenhuma VALIDADA com aprovacao resolvida -> cai para a mais recente (primeiro item)', () => {
    const maisRecente = { id: 'r1', status_validacao: 'REVISAO_MANUAL' as const, aprovacao_documental: undefined }
    const maisAntiga = { id: 'r2', status_validacao: 'REJEITADA' as const, aprovacao_documental: undefined }
    expect(resolverRemessaDestacada([maisRecente, maisAntiga])).toBe(maisRecente)
  })
})

describe('resolverLabelEnvioNfRemessa', () => {
  it('sem remessa mais recente -> "Enviar outra NF de Remessa"', () => {
    expect(resolverLabelEnvioNfRemessa(null)).toBe('Enviar outra NF de Remessa')
  })

  it('remessa mais recente REJEITADA -> "Enviar nova versão" (corrige/substitui o lastro)', () => {
    expect(resolverLabelEnvioNfRemessa({ status_validacao: 'REJEITADA' })).toBe('Enviar nova versão')
  })

  it('remessa mais recente VALIDADA/REVISAO_MANUAL -> "Enviar outra NF de Remessa" (remessa adicional)', () => {
    expect(resolverLabelEnvioNfRemessa({ status_validacao: 'VALIDADA' })).toBe('Enviar outra NF de Remessa')
    expect(resolverLabelEnvioNfRemessa({ status_validacao: 'REVISAO_MANUAL' })).toBe('Enviar outra NF de Remessa')
  })
})
