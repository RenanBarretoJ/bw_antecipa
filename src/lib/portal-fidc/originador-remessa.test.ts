import { describe, it, expect } from 'vitest'
import { validarOriginadorRemessa } from './originador-remessa'

describe('originador da remessa', () => {
  it.each(['publicada', 'substituida'])('usa snapshot CNAB %s quando integracao foi ativada antes do CNAB', (status) => {
    expect(() => validarOriginadorRemessa({ codigo_originador: '00123', status }, null)).not.toThrow()
  })
  it('preserva a comparacao das integracoes historicas', () => {
    expect(() => validarOriginadorRemessa({ codigo_originador: '00123', status: 'publicada' }, '00123')).not.toThrow()
    expect(() => validarOriginadorRemessa({ codigo_originador: '00123', status: 'publicada' }, '00456')).toThrow(/diverge/)
  })
  it.each(['rascunho', 'cancelada', ''])('bloqueia envio com CNAB %s', (status) => {
    expect(() => validarOriginadorRemessa({ codigo_originador: '00123', status }, null)).toThrow(/publicada/)
  })
  it('bloqueia ausencia de CNAB ou originador invalido', () => {
    expect(() => validarOriginadorRemessa(null, null)).toThrow()
    expect(() => validarOriginadorRemessa({ codigo_originador: '', status: 'publicada' }, null)).toThrow()
  })
})
