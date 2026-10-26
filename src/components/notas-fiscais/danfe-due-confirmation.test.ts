import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DanfeDueConfirmation } from './danfe-due-confirmation'

const review = { numero: '880101', bruto: 2765.43, emissao: '2026-09-16' }

describe('DANFE human due confirmation presentation', () => {
  it('renders a labelled, empty field with pending draft and no automatic debt promises', () => {
    const html = renderToStaticMarkup(createElement(DanfeDueConfirmation, { review, value: '', disabled: false, inputId: 'due-1', onDueChange: () => {} }))
    expect(html).toContain('for="due-1"')
    expect(html).toContain('aria-describedby="due-1-help due-1-state"')
    expect(html).toContain('type="date"')
    expect(html).toContain('required=""')
    expect(html).toContain('value=""')
    expect(html).toContain('Nenhuma nota foi criada ainda')
    expect(html).toContain('sem gerar duplicatas ou aprovar a cessão')
    expect(html).not.toContain('aprovada')
    expect(html).not.toContain('fileName')
  })
  it('preserves operator input and disables the field during upload', () => {
    const html = renderToStaticMarkup(createElement(DanfeDueConfirmation, { review, value: '2026-11-30', disabled: true, inputId: 'due-2', onDueChange: () => {} }))
    expect(html).toContain('value="2026-11-30"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('min="2026-09-16"')
    expect(html).toContain('registrada como manual')
  })
})
