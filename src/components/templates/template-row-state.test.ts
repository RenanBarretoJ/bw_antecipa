import { describe, expect, it } from 'vitest'
import { shouldOfferTemplateConfiguration } from './template-row-state'

describe('acao inicial da linha de template juridico', () => {
  it('oferece configuracao quando o template ainda nao existe', () => {
    expect(shouldOfferTemplateConfiguration({ hasTemplate: false, hasVersion: false })).toBe(true)
  })

  it('oferece configuracao para criar a primeira versao de um template existente', () => {
    expect(shouldOfferTemplateConfiguration({ hasTemplate: true, hasVersion: false })).toBe(true)
  })

  it('nao oferece configuracao inicial quando o template ja possui versao', () => {
    expect(shouldOfferTemplateConfiguration({ hasTemplate: true, hasVersion: true })).toBe(false)
  })
})
