import { extractDanfeFromPdf, type NfPdfExtracted } from '@/lib/pdf-nf-parser'
import type { NfParsedData } from '@/lib/nf-parser'
import type { NfseExtraction } from '@/lib/nfse/contracts'
import { validateNfseExtraction } from '@/lib/nfse/danfse-v2'
import { formatarDetalhesBloqueioEmitente, validarXmlNfeParaUploadCedente } from '@/lib/notas-fiscais/emitente-autorizado'

export interface NotaFiscalBaseReferencia {
  tipoDocumentoFiscal?: 'NFE' | 'NFSE' | null
  chaveAcesso: string | null
  numero: string | null
  serie: string | null
  cnpjEmitente: string | null
  cnpjDestinatario: string | null
}

export interface DocumentoBaseValidado {
  codigo: 'nf_xml' | 'nf_danfe_pdf'
  chaveAcesso: string | null
  numero: string | null
  serie: string | null
  camposExtraidos: string[]
}

function somenteDigitos(value: string | null | undefined) {
  return String(value ?? '').replace(/\D/g, '')
}

function normalizarTexto(value: string | null | undefined) {
  return String(value ?? '').trim()
}

function normalizarNumero(value: string | null | undefined) {
  return normalizarTexto(value).replace(/^0+(?=\d)/, '')
}

function validarCorrespondenciaComNf(input: {
  referencia: NotaFiscalBaseReferencia
  chaveAcesso?: string | null
  numero?: string | null
  serie?: string | null
  cnpjDestinatario?: string | null
}) {
  const chaveEsperada = normalizarTexto(input.referencia.chaveAcesso)
  const chaveEncontrada = normalizarTexto(input.chaveAcesso)
  if (chaveEsperada && chaveEncontrada && chaveEsperada !== chaveEncontrada) {
    throw new Error('O documento-base nao corresponde a chave de acesso da NF.')
  }

  const numeroEsperado = normalizarNumero(input.referencia.numero)
  const numeroEncontrado = normalizarNumero(input.numero)
  if (numeroEsperado && numeroEncontrado && numeroEsperado !== numeroEncontrado) {
    throw new Error('O documento-base nao corresponde ao numero da NF.')
  }

  const serieEsperada = normalizarNumero(input.referencia.serie)
  const serieEncontrada = normalizarNumero(input.serie)
  if (serieEsperada && serieEncontrada && serieEsperada !== serieEncontrada) {
    throw new Error('O documento-base nao corresponde a serie da NF.')
  }

  const destinatarioEsperado = somenteDigitos(input.referencia.cnpjDestinatario)
  const destinatarioEncontrado = somenteDigitos(input.cnpjDestinatario)
  if (destinatarioEsperado && destinatarioEncontrado && destinatarioEsperado !== destinatarioEncontrado) {
    throw new Error('O documento-base nao corresponde ao destinatario da NF.')
  }
}

function validarXmlBase(input: {
  xml: string
  referencia: NotaFiscalBaseReferencia
}): DocumentoBaseValidado {
  const resultado = validarXmlNfeParaUploadCedente({
    xmlContent: input.xml,
    cnpjCedente: input.referencia.cnpjEmitente || '',
  })
  if (!resultado.ok) {
    const detalhes = formatarDetalhesBloqueioEmitente({
      cnpjCedente: resultado.cnpjCedente,
      cnpjEmitente: resultado.cnpjEmitente,
    })
    throw new Error(`${resultado.message}${detalhes}`)
  }

  const parsed = resultado.parsed
  validarCorrespondenciaComNf({
    referencia: input.referencia,
    chaveAcesso: parsed.chave_acesso,
    numero: parsed.numero_nf,
    serie: parsed.serie,
    cnpjDestinatario: parsed.cnpj_destinatario,
  })

  return {
    codigo: 'nf_xml',
    chaveAcesso: parsed.chave_acesso,
    numero: parsed.numero_nf,
    serie: parsed.serie,
    camposExtraidos: ['chave_acesso', 'numero_nf', 'serie', 'emitente', 'destinatario'],
  }
}

function validarDanfeBase(input: {
  parsed: NfPdfExtracted
  referencia: NotaFiscalBaseReferencia
}): DocumentoBaseValidado {
  const parsed = input.parsed
  if (!parsed.chave_acesso && !parsed.numero_nf) {
    throw new Error('O PDF nao foi reconhecido como DANFE da NF informada.')
  }

  validarCorrespondenciaComNf({
    referencia: input.referencia,
    chaveAcesso: parsed.chave_acesso,
    numero: parsed.numero_nf,
    serie: parsed.serie,
    cnpjDestinatario: parsed.cnpj_destinatario,
  })

  return {
    codigo: 'nf_danfe_pdf',
    chaveAcesso: parsed.chave_acesso || null,
    numero: parsed.numero_nf || null,
    serie: parsed.serie || null,
    camposExtraidos: parsed.campos_extraidos,
  }
}

export async function validarDocumentoBaseDaNota(input: {
  codigo: string
  arquivo: File
  referencia: NotaFiscalBaseReferencia
  parsedDanfe?: NfPdfExtracted
  parsedNfse?: NfseExtraction
}): Promise<DocumentoBaseValidado | null> {
  if (input.referencia.tipoDocumentoFiscal === 'NFSE') {
    if (input.codigo !== 'nf_danfe_pdf') throw new Error('NFS-e requer documento-base PDF correspondente.')
    const parsed = input.parsedNfse ?? await (await import('@/lib/nfse/pdf-dispatcher.server')).probeNfsePdf(Buffer.from(await input.arquivo.arrayBuffer()))
    if (!parsed || !validateNfseExtraction(parsed).ok) throw new Error('NFS-e nao reconhecida com seguranca.')
    const dados = parsed.dados
    if (somenteDigitos(dados.cnpj_emitente) !== somenteDigitos(input.referencia.cnpjEmitente)) throw new Error('Emitente da NFS-e divergente.')
    validarCorrespondenciaComNf({ referencia: input.referencia, chaveAcesso: dados.chave_acesso,
      numero: dados.numero_nf, cnpjDestinatario: dados.cnpj_destinatario })
    return { codigo: 'nf_danfe_pdf', chaveAcesso: dados.chave_acesso!, numero: dados.numero_nf!, serie: null, camposExtraidos: Object.keys(dados) }
  }
  if (input.codigo === 'nf_xml') return validarXmlBase({ xml: await input.arquivo.text(), referencia: input.referencia })
  if (input.codigo === 'nf_danfe_pdf') {
    // No upload inicial, reutiliza a leitura do MESMO arquivo feita antes do
    // Storage/INSERT. Continua conferindo a identidade contra a NF persistida.
    const parsed = input.parsedDanfe ?? await extractDanfeFromPdf(Buffer.from(await input.arquivo.arrayBuffer()))
    return validarDanfeBase({ parsed, referencia: input.referencia })
  }
  return null
}

export function validarDocumentoBaseDaNotaComDadosXml(input: {
  xml: string
  referencia: NotaFiscalBaseReferencia
}) {
  return validarXmlBase(input)
}

export function validarDocumentoBaseDaNotaComDadosDanfe(input: {
  parsed: NfPdfExtracted
  referencia: NotaFiscalBaseReferencia
}) {
  return validarDanfeBase(input)
}

export function extrairReferenciaNf(parsed: NfParsedData): NotaFiscalBaseReferencia {
  return {
    chaveAcesso: parsed.chave_acesso || null,
    numero: parsed.numero_nf || null,
    serie: parsed.serie || null,
    cnpjEmitente: parsed.cnpj_emitente || null,
    cnpjDestinatario: parsed.cnpj_destinatario || null,
  }
}
