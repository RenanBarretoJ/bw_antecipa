export type ArquivoFiscalTipo = 'XML' | 'DANFE' | 'PDF' | 'Imagem' | 'Arquivo'

export interface ArquivoFiscalResumo {
  id: string
  nome: string
  mimeType: string
  tipo: ArquivoFiscalTipo
  tamanhoBytes: number | null
  numeroVersao: number | null
}

export function metadadosArquivoFiscal(nome: string, mime: string | null, danfe = false) {
  const mimeType = mime?.split(';', 1)[0].trim().toLowerCase()
    || (/\.xml$/i.test(nome) ? 'application/xml' : /\.pdf$/i.test(nome) ? 'application/pdf' : 'application/octet-stream')
  const tipo: ArquivoFiscalTipo = mimeType === 'application/xml' || mimeType === 'text/xml' || /\.xml$/i.test(nome)
    ? 'XML'
    : mimeType === 'application/pdf' || /\.pdf$/i.test(nome)
      ? danfe ? 'DANFE' : 'PDF'
      : mimeType.startsWith('image/') ? 'Imagem' : 'Arquivo'
  return { nome, mimeType, tipo }
}
