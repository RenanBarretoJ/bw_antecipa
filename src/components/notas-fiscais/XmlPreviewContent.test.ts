import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { resolvePreviewType, XmlPreviewText } from './FilePreviewContent'

describe('XML de visualização inerte', () => {
  it.each([['nota.xml?token=temporario', undefined], ['sem-extensao', 'application/xml; charset=utf-8'], ['sem-extensao', 'text/xml'], ['NOTA.XML', 'application/octet-stream']])('reconhece XML sem alterar os outros renderers: %s', (path, mimeType) => {
    expect(resolvePreviewType({ path, mimeType })).toBe('xml')
  })
  it.each(['<script>globalThis.executado=true</script>', '<img src="https://example.invalid" onerror="alert(1)">', '<![CDATA[<svg onload="alert(1)">]]>', '<!DOCTYPE x [<!ENTITY ext SYSTEM "file:///secret">]><x>&ext;</x>', '<x nome="&AMP;">&entidade;</x>'])('mostra conteúdo como texto, sem HTML/entidades executáveis', text => {
    const html = renderToStaticMarkup(createElement(XmlPreviewText, { text, title: 'Nota', className: '' }))
    expect(html).toContain('<pre'); expect(html).toContain('&lt;')
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img '); expect(html).not.toContain('<svg ')
    expect(html).not.toContain('dangerouslySetInnerHTML')
  })
})
