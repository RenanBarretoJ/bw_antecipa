import { parseNFeXML, type NfParsedData } from '@/lib/nf-parser'

export type ValidacaoEmitenteAutorizadoOk = {
  ok: true
  cnpjCedente: string
  cnpjEmitente: string
  cnpjChaveAcesso: string
}

export type ValidacaoEmitenteAutorizadoErro = {
  ok: false
  code:
    | 'CNPJ_CEDENTE_INVALIDO'
    | 'CNPJ_EMITENTE_INVALIDO'
    | 'CHAVE_ACESSO_INVALIDA'
    | 'CHAVE_EMITENTE_DIVERGENTE'
    | 'EMITENTE_NAO_AUTORIZADO'
  message: string
  cnpjCedente?: string
  cnpjEmitente?: string
  cnpjChaveAcesso?: string
}

export type ValidacaoEmitenteAutorizado =
  | ValidacaoEmitenteAutorizadoOk
  | ValidacaoEmitenteAutorizadoErro

export type PreValidacaoXmlNfeCedente =
  | {
      ok: true
      parsed: NfParsedData
      cnpjCedente: string
      cnpjEmitente: string
      cnpjChaveAcesso: string
    }
  | {
      ok: false
      code: ValidacaoEmitenteAutorizadoErro['code']
      message: string
      cnpjCedente?: string
      cnpjEmitente?: string
      cnpjChaveAcesso?: string
    }

const MENSAGEM_EMITENTE_DIVERGENTE =
  'A NF-e foi emitida por um CNPJ diferente do cedente cadastrado. No momento, somente NFs emitidas pelo próprio CNPJ podem ser importadas.'

export function normalizarCnpj14(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '')
}

export function cnpjPossui14Digitos(value: string | null | undefined): boolean {
  return normalizarCnpj14(value).length === 14
}

export function extrairChaveAcessoNfeDoXml(xmlContent: string): string {
  const match = xmlContent.match(/<infNFe\b[^>]*\bId\s*=\s*["']NFe([^"']+)["']/i)
  return match?.[1]?.trim() || ''
}

export function extrairCnpjDaChaveAcesso(chaveAcesso: string): string {
  return chaveAcesso.slice(6, 20)
}

export function validarEmitenteAutorizadoParaCedente(input: {
  cnpjCedente: string
  cnpjEmitente: string
  chaveAcesso: string
}): ValidacaoEmitenteAutorizado {
  const cnpjCedente = normalizarCnpj14(input.cnpjCedente)
  const cnpjEmitente = normalizarCnpj14(input.cnpjEmitente)
  const chaveAcesso = String(input.chaveAcesso ?? '').trim()

  if (!cnpjPossui14Digitos(cnpjCedente)) {
    return {
      ok: false,
      code: 'CNPJ_CEDENTE_INVALIDO',
      message: 'CNPJ cadastrado do cedente está inválido. Solicite correção cadastral antes de importar NF-e.',
      cnpjCedente,
      cnpjEmitente,
    }
  }

  if (!cnpjPossui14Digitos(cnpjEmitente)) {
    return {
      ok: false,
      code: 'CNPJ_EMITENTE_INVALIDO',
      message: 'CNPJ do emitente da NF-e está inválido ou ausente no XML.',
      cnpjCedente,
      cnpjEmitente,
    }
  }

  if (!/^\d{44}$/.test(chaveAcesso)) {
    return {
      ok: false,
      code: 'CHAVE_ACESSO_INVALIDA',
      message: 'Chave de acesso da NF-e inválida. A chave deve possuir exatamente 44 dígitos.',
      cnpjCedente,
      cnpjEmitente,
    }
  }

  const cnpjChaveAcesso = extrairCnpjDaChaveAcesso(chaveAcesso)

  if (cnpjChaveAcesso !== cnpjEmitente) {
    return {
      ok: false,
      code: 'CHAVE_EMITENTE_DIVERGENTE',
      message: 'A chave de acesso da NF-e pertence a um CNPJ diferente do emitente informado no XML.',
      cnpjCedente,
      cnpjEmitente,
      cnpjChaveAcesso,
    }
  }

  // Regra atual: igualdade exata entre CNPJ do emitente e CNPJ cadastrado do cedente.
  // Evolução futura: substituir este ponto por consulta a matriz/filiais/CNPJs autorizados
  // sem alterar o fluxo de upload, Storage ou persistência.
  if (cnpjEmitente !== cnpjCedente) {
    return {
      ok: false,
      code: 'EMITENTE_NAO_AUTORIZADO',
      message: MENSAGEM_EMITENTE_DIVERGENTE,
      cnpjCedente,
      cnpjEmitente,
      cnpjChaveAcesso,
    }
  }

  return {
    ok: true,
    cnpjCedente,
    cnpjEmitente,
    cnpjChaveAcesso,
  }
}

export function validarXmlNfeParaUploadCedente(input: {
  xmlContent: string
  cnpjCedente: string
}): PreValidacaoXmlNfeCedente {
  const parsed = parseNFeXML(input.xmlContent)
  const chaveAcesso = extrairChaveAcessoNfeDoXml(input.xmlContent) || parsed.chave_acesso
  const validacao = validarEmitenteAutorizadoParaCedente({
    cnpjCedente: input.cnpjCedente,
    cnpjEmitente: parsed.cnpj_emitente,
    chaveAcesso,
  })

  if (!validacao.ok) return validacao

  return {
    ok: true,
    parsed: {
      ...parsed,
      chave_acesso: chaveAcesso,
      cnpj_emitente: validacao.cnpjEmitente,
    },
    cnpjCedente: validacao.cnpjCedente,
    cnpjEmitente: validacao.cnpjEmitente,
    cnpjChaveAcesso: validacao.cnpjChaveAcesso,
  }
}

export function formatarDetalhesBloqueioEmitente(input: {
  cnpjCedente?: string
  cnpjEmitente?: string
}) {
  const details: string[] = []
  if (input.cnpjEmitente) details.push(`CNPJ encontrado no XML: ${input.cnpjEmitente}`)
  if (input.cnpjCedente) details.push(`CNPJ cadastrado do cedente: ${input.cnpjCedente}`)
  return details.length ? ` ${details.join(' | ')}` : ''
}
