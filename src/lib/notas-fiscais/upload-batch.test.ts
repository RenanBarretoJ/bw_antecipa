import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { arquivosPendentesDeRetry, executarUploadPorArquivo, resumirUploadBatch, type UploadFileResult } from './upload-batch'

const imported = (fileName: string): UploadFileResult => ({ fileName, status: 'IMPORTED', nfId: fileName })
const failed = (fileName: string, status: Exclude<UploadFileResult['status'], 'IMPORTED'>): UploadFileResult => ({
  fileName,
  status,
  message: 'Nao importado.',
})

describe('resultado por arquivo do upload de NFs', () => {
  it('mantem gate PDF e checagem de duplicidade antes do Storage', () => {
    const source = readFileSync('src/lib/actions/nota-fiscal.ts', 'utf8')
    const pdfBranch = source.slice(source.indexOf('      let extracted: NfPdfExtracted'), source.indexOf('      const today = new Date()'))
    const uploadIndex = pdfBranch.indexOf('.from(buckets.notasFiscais).upload(filePath, arquivo)')
    expect(uploadIndex).toBeGreaterThan(0)
    expect(pdfBranch.indexOf('if (!valorTotalExtraidoValido(extracted)')).toBeLessThan(uploadIndex)
    expect(pdfBranch.indexOf('if (extracted.chave_acesso)')).toBeLessThan(uploadIndex)
  })

  it.each([
    [['MK.pdf', 'BAHIAMED.pdf'], 2, 0],
    [['MK.pdf', 'BAHIAMED.pdf', 'OUTRO.pdf'], 3, 0],
  ] as const)('importa todos os PDFs validos (%j)', (nomes, sucessos, erros) => {
    const batch = resumirUploadBatch(nomes.map(imported))
    expect([batch.successCount, batch.errorCount]).toEqual([sucessos, erros])
    expect(arquivosPendentesDeRetry(nomes, batch)).toEqual([])
  })

  it('preserva MK e BAHIAMED e deixa so o ambiguo na fila do lote misto', () => {
    const nomes = ['MK.pdf', 'BAHIAMED.pdf', 'ambíguo #1.pdf']
    const batch = resumirUploadBatch([
      imported(nomes[0]),
      imported(nomes[1]),
      failed(nomes[2], 'REJECTED_AMBIGUOUS'),
    ])
    expect([batch.total, batch.successCount, batch.errorCount]).toEqual([3, 2, 1])
    expect(arquivosPendentesDeRetry(nomes, batch)).toEqual([nomes[2]])
  })

  it('retém os dois PDFs ambiguos, sem contabilizar sucesso', () => {
    const nomes = ['a.pdf', 'b.pdf']
    const batch = resumirUploadBatch(nomes.map((nome) => failed(nome, 'REJECTED_AMBIGUOUS')))
    expect([batch.successCount, batch.errorCount]).toEqual([0, 2])
    expect(arquivosPendentesDeRetry(nomes, batch)).toEqual(nomes)
  })

  it.each(['DUPLICATE', 'STORAGE_ERROR', 'PERSISTENCE_ERROR'] as const)(
    'nao esconde o PDF valido quando o outro retorna %s',
    (status) => {
      const nomes = ['valido.pdf', 'falho.pdf']
      const batch = resumirUploadBatch([imported(nomes[0]), failed(nomes[1], status)])
      expect([batch.successCount, batch.errorCount]).toEqual([1, 1])
      expect(arquivosPendentesDeRetry(nomes, batch)).toEqual(['falho.pdf'])
    },
  )

  it('mantem a ordem XML + PDF e diferencia nomes repetidos pelo indice', () => {
    const arquivos = [{ name: 'nota.xml' }, { name: 'NF.pdf' }, { name: 'NF.pdf' }]
    const batch = resumirUploadBatch([
      imported('nota.xml'),
      imported('NF.pdf'),
      failed('NF.pdf', 'DUPLICATE'),
    ])
    expect(arquivosPendentesDeRetry(arquivos, batch)).toEqual([arquivos[2]])
  })

  it('preserva nomes de arquivo com caracteres especiais no resultado e no retry', async () => {
    const files = [{ name: 'NF João #1.pdf' }, { name: 'DANFE (revisão) & filial.pdf' }]
    const result = await executarUploadPorArquivo(files, async (file) => file === files[0]
      ? { ok: true, id: 'nf-valida', isRascunho: true }
      : { ok: false, status: 'REJECTED_AMBIGUOUS', error: 'Valor total ambíguo.' })
    expect(result.batch.results.map((item) => item.fileName)).toEqual(files.map((file) => file.name))
    expect(arquivosPendentesDeRetry(files, result.batch)).toEqual([files[1]])
  })

  it('processa em paralelo sem que um PDF ambiguo interrompa MK e BAHIAMED', async () => {
    const files = ['MK.pdf', 'ambíguo.pdf', 'BAHIAMED.pdf'].map((name) => ({ name }))
    const processar = vi.fn(async (file: { name: string }) => file.name === 'ambíguo.pdf'
      ? { ok: false as const, status: 'REJECTED_AMBIGUOUS' as const, error: 'Valor total ambíguo.' }
      : { ok: true as const, id: file.name, isRascunho: true, nfNumero: file.name })
    const result = await executarUploadPorArquivo(files, processar)
    expect([result.batch.successCount, result.batch.errorCount]).toEqual([2, 1])
    expect(result.ids).toEqual(['MK.pdf', 'BAHIAMED.pdf'])
    expect(result.batch.results.map((item) => item.status)).toEqual(['IMPORTED', 'REJECTED_AMBIGUOUS', 'IMPORTED'])
    expect(processar).toHaveBeenCalledTimes(3)
  })

  it('mantem XML, PDF valido e falha de Storage individualizados', async () => {
    const files = ['NF.xml', 'MK.pdf', 'falha.pdf'].map((name) => ({ name }))
    const result = await executarUploadPorArquivo(files, async (file) => file.name === 'falha.pdf'
      ? { ok: false, status: 'STORAGE_ERROR', error: 'Falha ao armazenar.' }
      : { ok: true, id: file.name, isRascunho: true })
    expect(result.batch.results.map((item) => item.status)).toEqual(['IMPORTED', 'IMPORTED', 'STORAGE_ERROR'])
    expect(arquivosPendentesDeRetry(files, result.batch)).toEqual([files[2]])
  })

  it('converte rejeicao inesperada em falha individual sem ocultar sucesso', async () => {
    const files = ['MK.pdf', 'falha.pdf'].map((name) => ({ name }))
    const log = vi.fn()
    const result = await executarUploadPorArquivo(files, async (file) => {
      if (file.name === 'falha.pdf') throw new Error('detalhe interno')
      return { ok: true, id: 'nf-ok', isRascunho: true }
    }, log)
    expect([result.batch.successCount, result.batch.errorCount]).toEqual([1, 1])
    expect(result.batch.results[1]).toMatchObject({ status: 'PERSISTENCE_ERROR' })
    expect(JSON.stringify(result.batch)).not.toContain('detalhe interno')
    expect(log).toHaveBeenCalledOnce()
  })
})
