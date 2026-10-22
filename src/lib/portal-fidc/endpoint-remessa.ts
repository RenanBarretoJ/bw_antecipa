const IMPORTACAO_REMESSA = 'importacaoArquivoRemessa'

/** Resolve apenas o endereco SOAP conhecido, sem trocar host ou consultar WSDL em runtime. */
export function resolverEndpointRemessaPortalFidc(endpointBase: string): string {
  let url: URL
  try {
    url = new URL(endpointBase.trim())
  } catch {
    throw erroEndpoint()
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw erroEndpoint()

  const path = url.pathname.replace(/\/+$/, '')
  if (path.endsWith('/servicos/soap')) {
    url.pathname = `${path}/${IMPORTACAO_REMESSA}`
  } else if (path.endsWith(`/servicos/soap/${IMPORTACAO_REMESSA}`)) {
    url.pathname = path
  } else {
    // Endpoints completos personalizados continuam sendo responsabilidade da versao publicada.
    return url.toString()
  }
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase() === 'wsdl') url.searchParams.delete(key)
  }
  return url.toString()
}

function erroEndpoint() {
  return Object.assign(new Error('Endpoint HTTPS do Portal FIDC invalido. Revise a configuracao da integracao.'), { categoria: 'configuracao' })
}
