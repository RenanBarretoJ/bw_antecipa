import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPreviewImage, isPreviewPdf, resolvePreviewType } from './FilePreviewContent'

describe('FilePreviewContent', () => {
  it('preserva PDF no renderer protegido atual', () => {
    expect(isPreviewPdf('contrato.pdf?token=temporario')).toBe(true)
    expect(resolvePreviewType({ path: 'arquivo-sem-extensao', mimeType: 'application/pdf' })).toBe('pdf')

    const source = readFileSync(join(process.cwd(), 'src/components/notas-fiscais/FilePreviewContent.tsx'), 'utf8')
    expect(source).toContain("fetch(url, { credentials: 'omit' })")
    expect(source).toContain('URL.createObjectURL(blob)')
    expect(source).toContain('<iframe src={blobUrl}')
  })

  it.each([
    ['imagem.png?token=temporario', undefined],
    ['imagem.jpg?token=temporario', undefined],
    ['imagem.jpeg?token=temporario', undefined],
    ['imagem.webp?token=temporario', undefined],
    ['arquivo-sem-extensao', 'image/png'],
    ['legado.JPG?token=temporario', 'application/octet-stream'],
  ])('resolve imagem por extensao ou MIME: %s', (path, mimeType) => {
    expect(isPreviewImage(path, mimeType)).toBe(true)
  })

  it('nao inventa preview para TIFF, HEIC ou formato desconhecido', () => {
    expect(resolvePreviewType({ path: 'documento.tiff' })).toBe('unsupported')
    expect(resolvePreviewType({ path: 'documento.heic' })).toBe('unsupported')
    expect(resolvePreviewType({ path: 'documento.bin', mimeType: 'application/octet-stream' })).toBe('unsupported')
  })

  it('mantem loading, erro, retry e abertura segura para imagens', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/notas-fiscais/FilePreviewContent.tsx'), 'utf8')
    expect(source).toContain('Carregando documento...')
    expect(source).toContain('Não foi possível carregar a imagem deste documento.')
    expect(source).toContain('Tentar novamente')
    expect(source).toContain("window.open(url, '_blank', 'noopener,noreferrer')")
    expect(source).toContain("onError={() => setImageStatus('failed')}")
  })

  it('preserva aprovacao e reprovacao depois da abertura do preview', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/documentos/DocumentosGestorListagem.tsx'), 'utf8')
    expect(source).toContain("analisar('aprovado')")
    expect(source).toContain("analisar('reprovado')")
    expect(source).toContain('filePath={modal.fileName}')
  })
})
