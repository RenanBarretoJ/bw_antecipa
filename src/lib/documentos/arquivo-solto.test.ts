import { describe, expect, it } from 'vitest'
import { selecionarArquivoSolto } from './arquivo-solto'

describe('seleção de documento por arraste', () => {
  const pdf = new File(['%PDF-1.7'], 'termo.pdf', { type: 'application/pdf' })
  it('encaminha o mesmo arquivo, sem modificar seu conteúdo', () => {
    expect(selecionarArquivoSolto([pdf], 'application/pdf,.pdf')).toBe(pdf)
  })
  it('não envia nada quando não há arquivo', () => {
    expect(selecionarArquivoSolto([], 'application/pdf')).toBeNull()
  })
  it('recusa vários arquivos sem enviar parcialmente o primeiro', () => {
    expect(() => selecionarArquivoSolto([pdf, pdf], 'application/pdf')).toThrow('apenas um arquivo')
  })
  it.each(['text/plain', 'image/png', 'application/xml'])(
    'recusa um arquivo incompatível de tipo %s', tipo => {
      expect(() => selecionarArquivoSolto([new File(['conteúdo'], 'outro.txt', { type: tipo })], 'application/pdf,.pdf')).toThrow('Formato não aceito')
    },
  )
  it('respeita extensão configurada sem depender do MIME fornecido pelo navegador', () => {
    const arquivo = new File(['%PDF-1.7'], 'TERMO.PDF')
    expect(selecionarArquivoSolto([arquivo], 'application/pdf, .pdf')).toBe(arquivo)
  })
  it('preserva outros formatos explicitamente configurados', () => {
    const imagem = new File(['imagem'], 'imagem.png', { type: 'image/png' })
    expect(selecionarArquivoSolto([imagem], 'image/*')).toBe(imagem)
    expect(selecionarArquivoSolto([imagem], '')).toBe(imagem)
  })
})
