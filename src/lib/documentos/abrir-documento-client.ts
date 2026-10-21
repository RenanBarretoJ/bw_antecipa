import { nomeDownloadSeguro } from '@/lib/notas-fiscais/arquivo-fiscal-client'

export type AcaoArquivoDocumento = 'visualizar' | 'baixar'

/** Recebe somente a URL transitória retornada pelo endpoint autorizado. */
export function abrirDocumentoAutorizado(url: string, acao: AcaoArquivoDocumento, nome: string) {
  const destino = new URL(url, window.location.origin)
  if (!['https:', 'http:'].includes(destino.protocol)) throw new Error('Link do documento inválido.')
  // Mesma opção de Content-Disposition usada por createSignedUrl({ download }).
  // O arquivo segue direto do Storage para o navegador, sem cópia em memória.
  if (acao === 'baixar' && !destino.searchParams.get('download')) destino.searchParams.set('download', nomeDownloadSeguro(nome))
  window.open(destino.toString(), '_blank', 'noopener,noreferrer')
}
