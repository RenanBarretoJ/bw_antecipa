import { describe, expect, it } from 'vitest'
import {
  createPolicyInternalCode,
  derivePoliticaVersionState,
  getPoliticaDisplayState,
  mapLegacyFlagsToOperationalSelections,
  mapOperationalSelectionsToLegacyFlags,
  policyDocumentOptions,
  shouldClosePublishModal,
  shouldCloseVersionModalAfterCreate,
} from './ui'

describe('policy operational UI helpers', () => {
  it('maps descriptive choices to current legacy booleans', () => {
    expect(mapOperationalSelectionsToLegacyFlags({
      aceiteSacado: 'antes_desembolso',
      momentoCessao: 'desembolso',
      acompanhamentoEntrega: 'antes_liberacao_definitiva',
    })).toEqual({
      aceite_sacado_obrigatorio: true,
      cessao_no_desembolso: true,
      cria_acompanhamento_entrega: true,
    })

    expect(mapOperationalSelectionsToLegacyFlags({
      aceiteSacado: 'nao_exigido',
      momentoCessao: 'aprovacao',
      acompanhamentoEntrega: 'nao_aplicavel',
    })).toEqual({
      aceite_sacado_obrigatorio: false,
      cessao_no_desembolso: false,
      cria_acompanhamento_entrega: false,
    })
  })

  it('maps published legacy flags back to descriptive read-only labels', () => {
    expect(mapLegacyFlagsToOperationalSelections({
      aceite_sacado_obrigatorio: true,
      cessao_no_desembolso: false,
      cria_acompanhamento_entrega: true,
    })).toEqual({
      aceiteSacado: 'antes_cessao',
      momentoCessao: 'aprovacao',
      acompanhamentoEntrega: 'apos_desembolso',
    })
  })

  it('keeps the policy document catalog controlled and complete for the UI', () => {
    expect(policyDocumentOptions.map((option) => option.value)).toEqual([
      'nf_xml',
      'nf_danfe_pdf',
      'nf_pedido_compra',
      'contrato',
      'comprovante_entrega',
      'canhoto',
      'cte',
      'boleto',
      'duplicata',
      'comprovante_aceite',
      'outro',
    ])
  })

  it('generates an editable internal code from the selected link', () => {
    expect(createPolicyInternalCode('ABC-1234-XYZ')).toBe('politica_abc1234x')
    expect(createPolicyInternalCode('')).toBe('politica_vinculo')
  })

  it('keeps the first draft in history and marks the policy as in preparation', () => {
    const state = derivePoliticaVersionState([
      { id: 'v1', versao: 1, publicada_em: null },
    ])

    expect(state.possuiVersoes).toBe(true)
    expect(state.versaoRascunho?.id).toBe('v1')
    expect(state.versaoPublicada).toBeNull()
    expect(state.historico.map((version) => version.id)).toEqual(['v1'])
    expect(getPoliticaDisplayState(state)).toBe('preparacao')
  })

  it('uses the non-replaced published version as the current operational policy', () => {
    const state = derivePoliticaVersionState([
      { id: 'v1', versao: 1, publicada_em: '2026-07-20T10:00:00Z', vigente_ate: null },
      { id: 'v2', versao: 2, publicada_em: null },
    ])

    expect(state.versaoPublicada?.id).toBe('v1')
    expect(state.versaoRascunho?.id).toBe('v2')
    expect(getPoliticaDisplayState(state)).toBe('vigente')
  })

  it('keeps replaced versions in the complete history', () => {
    const state = derivePoliticaVersionState([
      { id: 'v1', versao: 1, publicada_em: '2026-07-20T10:00:00Z', vigente_ate: '2026-07-21T10:00:00Z' },
      { id: 'v2', versao: 2, publicada_em: '2026-07-21T10:00:00Z', vigente_ate: null },
      { id: 'v3', versao: 3, publicada_em: null },
    ])

    expect(state.historico.map((version) => version.id)).toEqual(['v3', 'v2', 'v1'])
    expect(state.historico).toHaveLength(3)
  })

  it('does not allow closing the version modal when insert fails or returns no row', () => {
    expect(shouldCloseVersionModalAfterCreate({ success: false, message: 'Erro ao criar versao.' })).toBe(false)
    expect(shouldCloseVersionModalAfterCreate({ success: true })).toBe(false)
    expect(shouldCloseVersionModalAfterCreate({ success: true, data: { id: 'v1' } })).toBe(true)
  })

  it('keeps the publish confirmation open when publication fails', () => {
    expect(shouldClosePublishModal({ success: false, message: 'Sessao elevada obrigatoria.' })).toBe(false)
    expect(shouldClosePublishModal(undefined)).toBe(false)
    expect(shouldClosePublishModal({ success: true, message: 'Publicado.' })).toBe(true)
  })
})
