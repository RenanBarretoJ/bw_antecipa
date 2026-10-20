/** Upload autenticado ao backend; nunca recebe bucket, path ou credencial. */
export async function enviarDocumentoAssinado(endpoint: string, arquivo: File): Promise<string> {
  const form = new FormData()
  form.append('arquivo', arquivo)
  const response = await fetch(endpoint, { method: 'POST', body: form })
  const resultado = await response.json().catch(() => null)
  if (!response.ok || !resultado?.path || typeof resultado.path !== 'string') {
    // Somente mensagens de dominio do endpoint; falhas de proxy nao sao JSON.
    throw new Error(
      typeof resultado?.error === 'string'
        ? resultado.error
        : 'Não foi possível salvar o contrato assinado. Tente novamente.',
    )
  }
  return resultado.path
}

/** A confirmacao visual so acontece depois da persistencia, inclusive no legado. */
export async function concluirUploadDocumentoAssinado(
  enviar: () => Promise<string>,
  onSuccess: (path: string) => void | Promise<void>,
): Promise<string> {
  const path = await enviar()
  await onSuccess(path)
  return path
}
