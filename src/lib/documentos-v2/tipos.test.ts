import { describe, expect, it } from 'vitest'
import { extensaoArquivo, mimeArquivo, validarArquivoContraTipo, sha256Arquivo } from './tipos'

const tipo = {
  id: 'tipo-1', codigo: 'nf_xml', nome: 'XML da NF-e',
  mime_types_aceitos: ['application/xml', 'text/xml'], extensoes_aceitas: ['xml'],
  tamanho_max_bytes: 20 * 1024 * 1024, permite_multiplas_versoes: true, ativo: true,
}

describe('catalogo documental v2', () => {
  it('normaliza extensao e MIME ausente', () => {
    expect(extensaoArquivo('NF emitida.XML')).toBe('xml')
    expect(mimeArquivo(new File(['<xml/>'], 'nf.xml', { type: '' }))).toBe('application/xml')
  })

  it('valida formato e tamanho conforme o tipo catalogado', () => {
    expect(validarArquivoContraTipo(new File(['<xml/>'], 'nf.xml', { type: 'application/xml' }), tipo)).toBeNull()
    expect(validarArquivoContraTipo(new File(['pdf'], 'nf.pdf', { type: 'application/pdf' }), tipo)).toMatch(/Formato invalido/i)
    expect(validarArquivoContraTipo(new File([''], 'nf.xml', { type: 'application/xml' }), tipo)).toMatch(/vazio/i)
  })

  it('calcula hash deterministico', async () => {
    const file = new File(['conteudo'], 'nf.xml', { type: 'application/xml' })
    expect(await sha256Arquivo(file)).toBe('92359bb294288000958de4f1f20d5778681b14bfe2f0868104f79230942a6984')
  })
})
