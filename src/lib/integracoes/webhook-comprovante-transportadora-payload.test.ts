import { describe, expect, it } from 'vitest'
import {
  MAX_IMAGEM_BASE64_BYTES,
  construirRequestPayloadSanitizado,
  decodificarImagemBase64,
  mimeDeclaradoCompativel,
  mimeRealDoBuffer,
  validarPayloadComprovanteWebhook,
} from './webhook-comprovante-transportadora-payload'

const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')
const JPEG_BASE64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64')
const PDF_BASE64 = Buffer.from('%PDF-1.4 conteudo').toString('base64')

function payloadValido(overrides: Record<string, unknown> = {}) {
  return {
    chave_nfe: '1'.repeat(44),
    chave_cte: null,
    cnpj_cliente: '11222333000181',
    cnpj_emitente: '11222333000181',
    cnpj_transportadora: '11222333000181',
    content_type: 'image/png',
    data_emissao_nfe: '2026-08-20T10:00:00Z',
    data_entrega_nfe: '2026-08-22T10:00:00Z',
    imagem_base64: PNG_BASE64,
    ...overrides,
  }
}

describe('validarPayloadComprovanteWebhook', () => {
  it('aceita um payload valido e normaliza os digitos/campos', () => {
    const chaveComPontuacao = `${'1'.repeat(22)}.${'1'.repeat(22)}`
    const resultado = validarPayloadComprovanteWebhook(payloadValido({ chave_nfe: chaveComPontuacao }))
    expect(resultado.ok).toBe(true)
    if (resultado.ok) expect(resultado.data.chaveNfe).toBe('1'.repeat(44))
  })

  it('rejeita corpo que nao e objeto', () => {
    expect(validarPayloadComprovanteWebhook(null).ok).toBe(false)
    expect(validarPayloadComprovanteWebhook([]).ok).toBe(false)
    expect(validarPayloadComprovanteWebhook('texto').ok).toBe(false)
  })

  it('exige chave_nfe com 44 digitos', () => {
    const r1 = validarPayloadComprovanteWebhook(payloadValido({ chave_nfe: '123' }))
    expect(r1).toMatchObject({ ok: false, codigo: 'CHAVE_NFE_INVALIDA' })
    const r2 = validarPayloadComprovanteWebhook(payloadValido({ chave_nfe: undefined }))
    expect(r2).toMatchObject({ ok: false, codigo: 'CHAVE_NFE_INVALIDA' })
  })

  it('chave_cte e opcional, mas quando presente precisa ter 44 digitos', () => {
    const semChave = validarPayloadComprovanteWebhook(payloadValido({ chave_cte: null }))
    expect(semChave.ok).toBe(true)
    const chaveInvalida = validarPayloadComprovanteWebhook(payloadValido({ chave_cte: '123' }))
    expect(chaveInvalida).toMatchObject({ ok: false, codigo: 'CHAVE_CTE_INVALIDA' })
    const chaveValida = validarPayloadComprovanteWebhook(payloadValido({ chave_cte: '2'.repeat(44) }))
    expect(chaveValida.ok).toBe(true)
    if (chaveValida.ok) expect(chaveValida.data.chaveCte).toBe('2'.repeat(44))
  })

  it.each(['cnpj_cliente', 'cnpj_emitente', 'cnpj_transportadora'])('rejeita %s com CNPJ fora do padrao de 14 digitos', (campo) => {
    const resultado = validarPayloadComprovanteWebhook(payloadValido({ [campo]: '123' }))
    expect(resultado.ok).toBe(false)
  })

  it('rejeita content_type fora do allowlist', () => {
    const resultado = validarPayloadComprovanteWebhook(payloadValido({ content_type: 'application/zip' }))
    expect(resultado).toMatchObject({ ok: false, codigo: 'CONTENT_TYPE_NAO_PERMITIDO' })
  })

  it('rejeita datas invalidas', () => {
    expect(validarPayloadComprovanteWebhook(payloadValido({ data_emissao_nfe: 'nao-e-data' }))).toMatchObject({ ok: false, codigo: 'DATA_EMISSAO_INVALIDA' })
    expect(validarPayloadComprovanteWebhook(payloadValido({ data_entrega_nfe: '' }))).toMatchObject({ ok: false, codigo: 'DATA_ENTREGA_INVALIDA' })
  })

  it('rejeita imagem_base64 ausente ou vazia', () => {
    expect(validarPayloadComprovanteWebhook(payloadValido({ imagem_base64: undefined }))).toMatchObject({ ok: false, codigo: 'IMAGEM_AUSENTE' })
    expect(validarPayloadComprovanteWebhook(payloadValido({ imagem_base64: '   ' }))).toMatchObject({ ok: false, codigo: 'IMAGEM_AUSENTE' })
  })

  it('rejeita base64 com caracteres invalidos ou padding incorreto', () => {
    expect(validarPayloadComprovanteWebhook(payloadValido({ imagem_base64: 'nao-e-base64!!!' }))).toMatchObject({ ok: false, codigo: 'IMAGEM_BASE64_INVALIDA' })
  })

  it('normaliza prefixo data:...;base64, antes de validar', () => {
    const resultado = validarPayloadComprovanteWebhook(payloadValido({ imagem_base64: `data:image/png;base64,${PNG_BASE64}` }))
    expect(resultado.ok).toBe(true)
    if (resultado.ok) expect(resultado.data.imagemBase64).toBe(PNG_BASE64)
  })

  it('rejeita imagem decodificada maior que o limite', () => {
    const grande = Buffer.alloc(MAX_IMAGEM_BASE64_BYTES + 10).toString('base64')
    const resultado = validarPayloadComprovanteWebhook(payloadValido({ imagem_base64: grande }))
    expect(resultado).toMatchObject({ ok: false, codigo: 'IMAGEM_TAMANHO_INVALIDO' })
  })

  it('external_event_id e opcional e vira null quando ausente/vazio', () => {
    const semEvento = validarPayloadComprovanteWebhook(payloadValido({ external_event_id: undefined }))
    if (semEvento.ok) expect(semEvento.data.externalEventId).toBeNull()
    const comEvento = validarPayloadComprovanteWebhook(payloadValido({ external_event_id: 'evt-123' }))
    if (comEvento.ok) expect(comEvento.data.externalEventId).toBe('evt-123')
  })
})

describe('mimeRealDoBuffer', () => {
  it('reconhece JPEG, PNG e PDF pelos magic bytes', () => {
    expect(mimeRealDoBuffer(Buffer.from(JPEG_BASE64, 'base64'))).toBe('image/jpeg')
    expect(mimeRealDoBuffer(Buffer.from(PNG_BASE64, 'base64'))).toBe('image/png')
    expect(mimeRealDoBuffer(Buffer.from(PDF_BASE64, 'base64'))).toBe('application/pdf')
  })

  it('retorna null para conteudo sem assinatura reconhecida', () => {
    expect(mimeRealDoBuffer(Buffer.from('conteudo qualquer sem assinatura'))).toBeNull()
  })
})

describe('mimeDeclaradoCompativel', () => {
  it('aceita image/jpeg e image/jpg como equivalentes ao mime real image/jpeg', () => {
    expect(mimeDeclaradoCompativel('image/jpeg', 'image/jpeg')).toBe(true)
    expect(mimeDeclaradoCompativel('image/jpeg', 'image/jpg')).toBe(true)
  })

  it('rejeita quando o mime real nao pode ser determinado', () => {
    expect(mimeDeclaradoCompativel(null, 'image/png')).toBe(false)
  })

  it('rejeita divergencia entre mime real e declarado', () => {
    expect(mimeDeclaradoCompativel('application/pdf', 'image/png')).toBe(false)
  })

  it('JPEG declarado + JPEG real -- compativel', () => {
    expect(mimeDeclaradoCompativel(mimeRealDoBuffer(Buffer.from(JPEG_BASE64, 'base64')), 'image/jpeg')).toBe(true)
  })

  it('JPEG declarado + PNG real -- incompativel (MIME_REAL_INCOMPATIVEL)', () => {
    expect(mimeDeclaradoCompativel(mimeRealDoBuffer(Buffer.from(PNG_BASE64, 'base64')), 'image/jpeg')).toBe(false)
  })

  it('JPEG declarado + PDF real -- incompativel (MIME_REAL_INCOMPATIVEL)', () => {
    expect(mimeDeclaradoCompativel(mimeRealDoBuffer(Buffer.from(PDF_BASE64, 'base64')), 'image/jpeg')).toBe(false)
  })
})

describe('decodificarImagemBase64', () => {
  it('decodifica, calcula sha256 e detecta o mime real', () => {
    const resultado = decodificarImagemBase64(PNG_BASE64)
    expect(resultado.buffer.byteLength).toBeGreaterThan(0)
    expect(resultado.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(resultado.mimeReal).toBe('image/png')
  })
})

describe('construirRequestPayloadSanitizado', () => {
  const validado = validarPayloadComprovanteWebhook(payloadValido({ external_event_id: 'evt-teste-123' }))
  if (!validado.ok) throw new Error('fixture invalida')
  const dadosValidados = validado.data
  const imagem = decodificarImagemBase64(dadosValidados.imagemBase64)

  function montar(overrides: Partial<Parameters<typeof construirRequestPayloadSanitizado>[0]> = {}) {
    return construirRequestPayloadSanitizado({
      payload: dadosValidados,
      bodyBytes: 2048,
      imagemBase64Length: dadosValidados.imagemBase64.length,
      imagemDecodificada: imagem,
      headers: { contentType: 'application/json', contentLength: '2048', userAgent: 'simfrete-webhook/1.0' },
      ...overrides,
    })
  }

  it('inclui todos os campos nao sensiveis do payload e do arquivo', () => {
    const resultado = montar()
    expect(resultado).toEqual({
      external_event_id: 'evt-teste-123',
      chave_nfe: dadosValidados.chaveNfe,
      chave_cte: null,
      cnpj_cliente: dadosValidados.cnpjCliente,
      cnpj_emitente: dadosValidados.cnpjEmitente,
      cnpj_transportadora: dadosValidados.cnpjTransportadora,
      data_emissao_nfe: dadosValidados.dataEmissaoNfe,
      data_entrega_nfe: dadosValidados.dataEntregaNfe,
      content_type_declarado: dadosValidados.contentType,
      tamanho_body_bytes: 2048,
      tamanho_base64: dadosValidados.imagemBase64.length,
      tamanho_decodificado_bytes: imagem.buffer.byteLength,
      imagem_sha256: imagem.sha256,
      mime_detectado: 'image/png',
      magic_bytes_hex: imagem.buffer.subarray(0, 16).toString('hex'),
      headers: { 'content-type': 'application/json', 'content-length': '2048', 'user-agent': 'simfrete-webhook/1.0' },
    })
  })

  it('nunca inclui imagem_base64 completa (nem em nenhuma chave do objeto)', () => {
    const resultado = montar()
    const serializado = JSON.stringify(resultado)
    expect(serializado).not.toContain(dadosValidados.imagemBase64)
    expect(Object.keys(resultado)).not.toContain('imagem_base64')
  })

  it('nunca inclui Authorization/Bearer, cookies ou qualquer header fora da allowlist', () => {
    const resultado = montar({
      headers: { contentType: 'application/json', contentLength: '2048', userAgent: 'simfrete-webhook/1.0' },
    })
    const serializado = JSON.stringify(resultado)
    expect(serializado.toLowerCase()).not.toContain('bearer')
    expect(serializado.toLowerCase()).not.toContain('authorization')
    expect(serializado.toLowerCase()).not.toContain('cookie')
    expect(Object.keys(resultado.headers).sort()).toEqual(['content-length', 'content-type', 'user-agent'])
  })

  it('magic_bytes_hex reflete os primeiros bytes reais do arquivo decodificado (assinatura PNG)', () => {
    const resultado = montar()
    expect(resultado.magic_bytes_hex.startsWith('89504e470d0a1a0a')).toBe(true)
    expect(resultado.magic_bytes_hex).toBe(imagem.buffer.subarray(0, 16).toString('hex'))
  })
})
