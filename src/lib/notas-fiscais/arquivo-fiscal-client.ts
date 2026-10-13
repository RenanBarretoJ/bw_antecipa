// Limite da ingestão fiscal atual. O preview textual usa um limite menor de UI.
export const MAX_FISCAL_DOWNLOAD_BYTES = 20 * 1024 * 1024
export const MAX_XML_PREVIEW_BYTES = 2 * 1024 * 1024

export async function lerArquivoLimitado(response: Response, maxBytes: number): Promise<Blob> {
  if (!response.ok) throw new Error('Arquivo indisponível.')
  const length = Number(response.headers.get('content-length'))
  if (length > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('Arquivo excede o limite de leitura.')
  }
  if (!response.body) throw new Error('Arquivo vazio ou indisponível.')
  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let bytes = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      bytes += result.value.byteLength
      if (bytes > maxBytes) throw new Error('Arquivo excede o limite de leitura.')
      chunks.push(new Uint8Array(result.value))
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  if (!bytes) throw new Error('Arquivo vazio ou indisponível.')
  return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' })
}

export function nomeDownloadSeguro(nome: string) {
  return (nome.split(/[\\/]/).pop() || 'arquivo')
    .replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').replace(/^\.+$/, 'arquivo')
}

export async function baixarArquivoFiscal(url: string, nome: string) {
  const response = await fetch(url, { credentials: 'omit' })
  const blob = await lerArquivoLimitado(response, MAX_FISCAL_DOWNLOAD_BYTES)
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    link.href = objectUrl
    link.download = nomeDownloadSeguro(nome)
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    // O navegador inicia a leitura antes de liberar a capacidade local.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  }
}
