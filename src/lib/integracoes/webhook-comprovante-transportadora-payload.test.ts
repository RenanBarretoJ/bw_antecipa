import { describe, expect, it } from 'vitest'
import {
  MAX_IMAGEM_BASE64_BYTES,
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
})

describe('decodificarImagemBase64', () => {
  it('decodifica, calcula sha256 e detecta o mime real', () => {
    const resultado = decodificarImagemBase64(PNG_BASE64)
    expect(resultado.buffer.byteLength).toBeGreaterThan(0)
    expect(resultado.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(resultado.mimeReal).toBe('image/png')
  })
})
