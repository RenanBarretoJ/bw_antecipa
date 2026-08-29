/**
 * Validacao/normalizacao PURA (sem I/O) do payload do webhook de
 * comprovante de entrega de transportadora. Ver
 * docs/integracoes/webhook-comprovante-transportadora.md.
 */

import { createHash } from 'node:crypto'

export type PayloadComprovanteWebhookValidado = {
  externalEventId: string | null
  chaveNfe: string
  chaveCte: string | null
  cnpjCliente: string
  cnpjEmitente: string
  cnpjTransportadora: string
  contentType: string
  dataEmissaoNfe: string
  dataEntregaNfe: string
  /** Base64 normalizado (sem prefixo data:...;base64, se enviado assim). */
  imagemBase64: string
}

export type ValidacaoPayloadResultado =
  | { ok: true; data: PayloadComprovanteWebhookValidado }
  | { ok: false; codigo: string; mensagem: string }

/** Limite generoso para uma imagem/PDF de comprovante -- mesma ordem de
 * grandeza do limite de 20MB ja usado para canhoto no fluxo humano
 * (validarTipoArquivo em src/lib/actions/logistica.ts). */
export const MAX_IMAGEM_BASE64_BYTES = 15 * 1024 * 1024

const CONTENT_TYPES_PERMITIDOS = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']

function apenasDigitos(valor: unknown): string {
  return typeof valor === 'string' ? valor.replace(/\D/g, '') : ''
}

function dataIsoValida(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !valor.trim()) return false
  return Number.isFinite(Date.parse(valor))
}

function normalizarBase64(valor: string): string {
  const semPrefixo = valor.startsWith('data:') && valor.includes(',') ? valor.slice(valor.indexOf(',') + 1) : valor
  return semPrefixo.trim()
}

/**
 * Valida e normaliza o corpo JSON do webhook. Nunca lanca -- sempre
 * retorna um resultado tipado, para o chamador decidir o status HTTP
 * (400 nesses casos, nunca 401/403 -- isso e responsabilidade da
 * autenticacao, resolvida antes desta funcao rodar).
 */
export function validarPayloadComprovanteWebhook(payload: unknown): ValidacaoPayloadResultado {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, codigo: 'PAYLOAD_INVALIDO', mensagem: 'Corpo da requisicao deve ser um objeto JSON.' }
  }
  const p = payload as Record<string, unknown>

  const chaveNfe = apenasDigitos(p.chave_nfe)
  if (!/^\d{44}$/.test(chaveNfe)) {
    return { ok: false, codigo: 'CHAVE_NFE_INVALIDA', mensagem: 'chave_nfe deve conter 44 digitos.' }
  }

  let chaveCte: string | null = null
  if (p.chave_cte !== undefined && p.chave_cte !== null && p.chave_cte !== '') {
    chaveCte = apenasDigitos(p.chave_cte)
    if (!/^\d{44}$/.test(chaveCte)) {
      return { ok: false, codigo: 'CHAVE_CTE_INVALIDA', mensagem: 'chave_cte, quando informada, deve conter 44 digitos.' }
    }
  }

  const cnpjCliente = apenasDigitos(p.cnpj_cliente)
  if (!/^\d{14}$/.test(cnpjCliente)) {
    return { ok: false, codigo: 'CNPJ_CLIENTE_INVALIDO', mensagem: 'cnpj_cliente deve conter 14 digitos.' }
  }

  const cnpjEmitente = apenasDigitos(p.cnpj_emitente)
  if (!/^\d{14}$/.test(cnpjEmitente)) {
    return { ok: false, codigo: 'CNPJ_EMITENTE_INVALIDO', mensagem: 'cnpj_emitente deve conter 14 digitos.' }
  }

  const cnpjTransportadora = apenasDigitos(p.cnpj_transportadora)
  if (!/^\d{14}$/.test(cnpjTransportadora)) {
    return { ok: false, codigo: 'CNPJ_TRANSPORTADORA_INVALIDO', mensagem: 'cnpj_transportadora deve conter 14 digitos.' }
  }

  const contentType = typeof p.content_type === 'string' ? p.content_type.toLowerCase().trim() : ''
  if (!CONTENT_TYPES_PERMITIDOS.includes(contentType)) {
    return { ok: false, codigo: 'CONTENT_TYPE_NAO_PERMITIDO', mensagem: `content_type deve ser um dos: ${CONTENT_TYPES_PERMITIDOS.join(', ')}.` }
  }

  if (!dataIsoValida(p.data_emissao_nfe)) {
    return { ok: false, codigo: 'DATA_EMISSAO_INVALIDA', mensagem: 'data_emissao_nfe deve ser uma data ISO-8601 valida.' }
  }
  if (!dataIsoValida(p.data_entrega_nfe)) {
    return { ok: false, codigo: 'DATA_ENTREGA_INVALIDA', mensagem: 'data_entrega_nfe deve ser uma data ISO-8601 valida.' }
  }

  if (typeof p.imagem_base64 !== 'string' || !p.imagem_base64.trim()) {
    return { ok: false, codigo: 'IMAGEM_AUSENTE', mensagem: 'imagem_base64 e obrigatoria.' }
  }
  const imagemBase64 = normalizarBase64(p.imagem_base64)
  if (!imagemBase64 || !/^[A-Za-z0-9+/]+=*$/.test(imagemBase64) || imagemBase64.length % 4 !== 0) {
    return { ok: false, codigo: 'IMAGEM_BASE64_INVALIDA', mensagem: 'imagem_base64 nao e uma string Base64 valida.' }
  }
  const tamanhoEstimado = Math.floor((imagemBase64.length * 3) / 4)
  if (tamanhoEstimado === 0 || tamanhoEstimado > MAX_IMAGEM_BASE64_BYTES) {
    return { ok: false, codigo: 'IMAGEM_TAMANHO_INVALIDO', mensagem: `imagem decodificada deve ter entre 1 byte e ${MAX_IMAGEM_BASE64_BYTES} bytes.` }
  }

  const externalEventId = typeof p.external_event_id === 'string' && p.external_event_id.trim() ? p.external_event_id.trim() : null

  return {
    ok: true,
    data: {
      externalEventId,
      chaveNfe,
      chaveCte,
      cnpjCliente,
      cnpjEmitente,
      cnpjTransportadora,
      contentType,
      dataEmissaoNfe: p.data_emissao_nfe as string,
      dataEntregaNfe: p.data_entrega_nfe as string,
      imagemBase64,
    },
  }
}

/** Assinaturas binarias (magic bytes) dos formatos aceitos -- decodifica e
 * confere o MIME REAL do arquivo, nunca confia apenas no content_type
 * declarado pelo provider (regra 6 do ticket). */
export function mimeRealDoBuffer(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf'
  return null
}

export function mimeDeclaradoCompativel(mimeReal: string | null, contentTypeDeclarado: string): boolean {
  if (!mimeReal) return false
  if (mimeReal === 'image/jpeg') return contentTypeDeclarado === 'image/jpeg' || contentTypeDeclarado === 'image/jpg'
  return mimeReal === contentTypeDeclarado
}

export type ImagemDecodificada = { buffer: Buffer; sha256: string; mimeReal: string | null }

export function decodificarImagemBase64(base64: string): ImagemDecodificada {
  const buffer = Buffer.from(base64, 'base64')
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  return { buffer, sha256, mimeReal: mimeRealDoBuffer(buffer) }
}

/** Quantos bytes iniciais do arquivo mostrar como magic bytes em HEX no diagnostico. */
const MAGIC_BYTES_DIAGNOSTICO = 16

export type RequestPayloadSanitizado = {
  external_event_id: string | null
  chave_nfe: string
  chave_cte: string | null
  cnpj_cliente: string
  cnpj_emitente: string
  cnpj_transportadora: string
  data_emissao_nfe: string
  data_entrega_nfe: string
  content_type_declarado: string
  tamanho_body_bytes: number
  tamanho_base64: number
  tamanho_decodificado_bytes: number
  imagem_sha256: string
  mime_detectado: string | null
  magic_bytes_hex: string
  headers: { 'content-type': string | null; 'content-length': string | null; 'user-agent': string | null }
}

/**
 * Monta o snapshot sanitizado do request recebido, para diagnostico
 * (P0_Claude_Webhook_Transportadora_Payloads_Auditoria_v2). Funcao pura --
 * nunca inclui imagem_base64 completa, Authorization/Bearer, cookies ou
 * qualquer outro header/segredo fora da allowlist explicita abaixo.
 */
export function construirRequestPayloadSanitizado(input: {
  payload: PayloadComprovanteWebhookValidado
  bodyBytes: number
  imagemBase64Length: number
  imagemDecodificada: ImagemDecodificada
  headers: { contentType: string | null; contentLength: string | null; userAgent: string | null }
}): RequestPayloadSanitizado {
  return {
    external_event_id: input.payload.externalEventId,
    chave_nfe: input.payload.chaveNfe,
    chave_cte: input.payload.chaveCte,
    cnpj_cliente: input.payload.cnpjCliente,
    cnpj_emitente: input.payload.cnpjEmitente,
    cnpj_transportadora: input.payload.cnpjTransportadora,
    data_emissao_nfe: input.payload.dataEmissaoNfe,
    data_entrega_nfe: input.payload.dataEntregaNfe,
    content_type_declarado: input.payload.contentType,
    tamanho_body_bytes: input.bodyBytes,
    tamanho_base64: input.imagemBase64Length,
    tamanho_decodificado_bytes: input.imagemDecodificada.buffer.byteLength,
    imagem_sha256: input.imagemDecodificada.sha256,
    mime_detectado: input.imagemDecodificada.mimeReal,
    magic_bytes_hex: input.imagemDecodificada.buffer.subarray(0, MAGIC_BYTES_DIAGNOSTICO).toString('hex'),
    headers: {
      'content-type': input.headers.contentType,
      'content-length': input.headers.contentLength,
      'user-agent': input.headers.userAgent,
    },
  }
}
