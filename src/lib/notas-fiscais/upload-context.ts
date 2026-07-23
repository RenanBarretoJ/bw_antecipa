export type AcaoDuplicidadeNotaFiscal = 'prosseguir' | 'conflito_xml_existente' | 'recuperar_registro_incompleto'

export function decidirAcaoDuplicidadeNotaFiscal(input: {
  existeNota: boolean
  possuiXmlDocumentalValido: boolean
}): AcaoDuplicidadeNotaFiscal {
  if (!input.existeNota) return 'prosseguir'
  return input.possuiXmlDocumentalValido ? 'conflito_xml_existente' : 'recuperar_registro_incompleto'
}

export function mensagemDuplicidadeNotaFiscal(acao: AcaoDuplicidadeNotaFiscal): string {
  if (acao === 'conflito_xml_existente') return 'NF com chave de acesso ja cadastrada.'
  if (acao === 'recuperar_registro_incompleto') {
    return 'NF com chave de acesso possuia registro incompleto sem XML; o sistema tentou recuperar o envio.'
  }
  return ''
}
