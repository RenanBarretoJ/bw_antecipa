import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { composeAiDanfeText, extractDanfeWithOpenAi } from './openai-pdf-fallback.server'
import { extractDanfeFromText, validarDanfeParaPersistencia } from '../pdf-nf-parser'

const ACCESS_KEY = '29260912345678000195550020001548061123456780'

const candidate = {
  document_type: 'nfe_danfe' as const,
  numero_nf: '154806',
  serie: '2',
  chave_acesso_blocos: null,
  chave_acesso: ACCESS_KEY,
  chaves_acesso_candidatas: [ACCESS_KEY],
  cnpj_emitente: '12.345.678/0001-95',
  cnpj_destinatario: '11.222.333/0001-81',
  razao_social_destinatario: 'DESTINATARIO QA',
  data_emissao: '2026-09-16',
  data_vencimento: '2026-10-31',
  valor_total_nota: 8371.99,
  confidence: 0.94,
}

describe('fallback OpenAI para DANFE PDF', () => {
  it('compoe evidencias canonicas e conserva os gates deterministas P12', () => {
    const parsed = extractDanfeFromText(composeAiDanfeText(candidate))
    expect(parsed).toMatchObject({
      numero_nf: '154806',
      serie: '2',
      chave_acesso: ACCESS_KEY,
      cnpj_emitente: '12345678000195',
      cnpj_destinatario: '11222333000181',
      data_emissao: '2026-09-16',
      data_vencimento: '2026-10-31',
      valor_bruto: 8371.99,
    })
    expect(validarDanfeParaPersistencia(parsed)).toEqual({ ok: true })
  })

  it('envia PDF em alta resolucao, sem armazenamento, e aceita somente JSON estruturado', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({ model: 'gpt-5.4-2026-03-05', store: false, max_output_tokens: 2400 })
      expect(JSON.stringify(body)).toContain('"detail":"high"')
      expect(JSON.stringify(body)).toContain('"strict":true')
      expect(JSON.stringify(body)).toContain('pagina vazia, verso vazio e canhoto repetido')
      expect(JSON.stringify(body)).toContain('"chave_acesso_blocos"')
      expect(JSON.stringify(body)).toContain('"minItems":11')
      return new Response(JSON.stringify({
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(candidate) }] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const result = await extractDanfeWithOpenAi(Buffer.from('%PDF synthetic'), 'NO_TEXT_LAYER', {
      env: { OPENAI_API_KEY: 'sk-test-never-log' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ confidence: 0.94, fallbackTriggerReason: 'NO_TEXT_LAYER' })
    expect(result.text).toContain(`CHAVE DE ACESSO ${ACCESS_KEY}`)
    expect(JSON.stringify(result)).not.toContain('sk-test-never-log')
  })

  it('falha fechado sem configuracao e nao inicia requisicao externa', async () => {
    const fetchImpl = vi.fn()
    await expect(extractDanfeWithOpenAi(Buffer.from('%PDF'), 'NO_TEXT_LAYER', {
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow('OPENAI_NF_NOT_CONFIGURED')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('descarta detalhes remotos e retorna somente codigo seguro', async () => {
    const fetchImpl = vi.fn(async () => new Response('credencial ou dado fiscal sensivel', { status: 401 }))
    await expect(extractDanfeWithOpenAi(Buffer.from('%PDF'), 'NO_TEXT_LAYER', {
      env: { OPENAI_API_KEY: 'sk-test' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow('OPENAI_NF_AUTH_FAILED')
  })

  it('repete uma unica vez quando a primeira leitura nao traz chave fiscal valida', async () => {
    const invalid = { ...candidate, chave_acesso: '1'.repeat(44), chaves_acesso_candidatas: [] }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(invalid) }] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [{ content: [{ type: 'output_text', text: JSON.stringify(candidate) }] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const result = await extractDanfeWithOpenAi(Buffer.from('%PDF'), 'NO_TEXT_LAYER', {
      env: { OPENAI_API_KEY: 'sk-test' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.text).toContain(ACCESS_KEY)
  })

  it('repete quando faltam campos fiscais criticos e falha fechado se persistir', async () => {
    const incomplete = { ...candidate, valor_total_nota: null }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: JSON.stringify(incomplete) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(extractDanfeWithOpenAi(Buffer.from('%PDF'), 'NO_TEXT_LAYER', {
      env: { OPENAI_API_KEY: 'sk-test' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow('OPENAI_NF_TOTAL_MISSING')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('faz a chave fiscal prevalecer sobre numero visual divergente', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      output: [{ content: [{
        type: 'output_text',
        text: JSON.stringify({ ...candidate, numero_nf: '999999' }),
      }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const result = await extractDanfeWithOpenAi(Buffer.from('%PDF'), 'NO_TEXT_LAYER', {
      env: { OPENAI_API_KEY: 'sk-test' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const parsed = extractDanfeFromText(result.text)
    expect(parsed.numero_nf).toBe('154806')
    expect(validarDanfeParaPersistencia(parsed)).toEqual({ ok: true })
  })

  it('repete uma vez resposta truncada e aceita apenas a resposta completa validada', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }))
      .mockResolvedValueOnce(Response.json({ status: 'completed', output_text: JSON.stringify(candidate) }))
    const result = await extractDanfeWithOpenAi(Buffer.from('%PDF'), 'NO_TEXT_LAYER', {
      env: { OPENAI_API_KEY: 'sk-test' }, fetchImpl,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(validarDanfeParaPersistencia(extractDanfeFromText(result.text))).toEqual({ ok: true })
  })

  it.each([
    ['incomplete', 'max_output_tokens', 'OPENAI_NF_OUTPUT_LIMIT', 2],
    ['incomplete', 'content_filter', 'OPENAI_NF_RESPONSE_INCOMPLETE', 1],
    ['failed', null, 'OPENAI_NF_RESPONSE_INCOMPLETE', 1],
  ])('nao aceita JSON parcial com status %s e motivo %s', async (status, reason, code, attempts) => {
    const fetchImpl = vi.fn(async () => Response.json({
      status, incomplete_details: { reason }, output_text: JSON.stringify(candidate),
    }))
    await expect(extractDanfeWithOpenAi(Buffer.from('%PDF'), 'NO_TEXT_LAYER', {
      env: { OPENAI_API_KEY: 'sk-test' }, fetchImpl,
    })).rejects.toThrow(String(code))
    expect(fetchImpl).toHaveBeenCalledTimes(Number(attempts))
  })

  it('nao registra nem repete recusa do provedor', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ status: 'completed', output: [{ content: [
      { type: 'refusal', refusal: 'dado sensivel do provedor' },
    ] }] }))
    await expect(extractDanfeWithOpenAi(Buffer.from('%PDF'), 'NO_TEXT_LAYER', {
      env: { OPENAI_API_KEY: 'sk-test' }, fetchImpl,
    })).rejects.toThrow('OPENAI_NF_RESPONSE_REFUSED')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('distingue requisicao invalida sem expor body do provedor', async () => {
    const fetchImpl = vi.fn(async () => new Response('segredo e documento', { status: 400 }))
    await expect(extractDanfeWithOpenAi(Buffer.from('%PDF'), 'NO_TEXT_LAYER', {
      env: { OPENAI_API_KEY: 'sk-test' }, fetchImpl,
    })).rejects.toThrow('OPENAI_NF_REQUEST_INVALID')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('preserva zeros dos blocos impressos quando a leitura concatenada perdeu um digito', async () => {
    // Synthetic key with consecutive zeros; no real customer document in this fixture.
    const body = '2926091234567800019555001000000042100000000'
    let sum = 0, weight = 2
    for (let i = 42; i >= 0; i--) { sum += Number(body[i]) * weight; weight = weight === 9 ? 2 : weight + 1 }
    const rest = sum % 11
    const key = body + (rest < 2 ? 0 : 11 - rest)
    expect(key).toHaveLength(44)
    const grouped = { ...candidate, numero_nf: '42', serie: '1',
      chave_acesso_blocos: key.match(/.{4}/g), chave_acesso: key.replace('0000', '000'), chaves_acesso_candidatas: [] }
    const fetchImpl = vi.fn(async () => Response.json({ status: 'completed', output_text: JSON.stringify(grouped) }))
    const result = await extractDanfeWithOpenAi(Buffer.from('%PDF'), 'NO_TEXT_LAYER', {
      env: { OPENAI_API_KEY: 'sk-test' }, fetchImpl,
    })
    const parsed = extractDanfeFromText(result.text)
    expect(parsed.chave_acesso).toBe(key)
    expect(parsed.numero_nf).toBe('42')
    expect(validarDanfeParaPersistencia(parsed)).toEqual({ ok: true })
  })

  it.each([
    Array(10).fill('0000'),
    Array(12).fill('0000'),
    [...Array(10).fill('0000'), '000'],
    [...Array(10).fill('0000'), '00O0'],
    [...Array(10).fill('0000'), 0],
  ])('nao completa nem normaliza blocos invalidos (%j)', async (...blocks) => {
    const fetchImpl = vi.fn(async () => Response.json({ status: 'completed', output_text: JSON.stringify({
      ...candidate, chave_acesso_blocos: blocks, chave_acesso: null, chaves_acesso_candidatas: [],
    }) }))
    await expect(extractDanfeWithOpenAi(Buffer.from('%PDF'), 'NO_TEXT_LAYER', {
      env: { OPENAI_API_KEY: 'sk-test' }, fetchImpl,
    })).rejects.toThrow('OPENAI_NF_INVALID_RESPONSE')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('nao recalcula digito verificador de blocos completos invalidos', async () => {
    const invalid = ACCESS_KEY.slice(0, -1) + '1'
    const fetchImpl = vi.fn(async () => Response.json({ status: 'completed', output_text: JSON.stringify({
      ...candidate, chave_acesso_blocos: invalid.match(/.{4}/g), chave_acesso: invalid, chaves_acesso_candidatas: [],
    }) }))
    await expect(extractDanfeWithOpenAi(Buffer.from('%PDF'), 'NO_TEXT_LAYER', {
      env: { OPENAI_API_KEY: 'sk-test' }, fetchImpl,
    })).rejects.toThrow('OPENAI_NF_ACCESS_KEY_INVALID')
  })

  it('rejeita chave em blocos e chave direta validas mas conflitantes', async () => {
    // Same synthetic body, different emission type and recalculated DV only in test data.
    const body = ACCESS_KEY.slice(0, 34) + '2' + ACCESS_KEY.slice(35, 43)
    let sum = 0, weight = 2
    for (let i = 42; i >= 0; i--) { sum += Number(body[i]) * weight; weight = weight === 9 ? 2 : weight + 1 }
    const rest = sum % 11
    const otherKey = body + (rest < 2 ? 0 : 11 - rest)
    const fetchImpl = vi.fn(async () => Response.json({ status: 'completed', output_text: JSON.stringify({
      ...candidate, chave_acesso_blocos: otherKey.match(/.{4}/g),
    }) }))
    await expect(extractDanfeWithOpenAi(Buffer.from('%PDF'), 'NO_TEXT_LAYER', {
      env: { OPENAI_API_KEY: 'sk-test' }, fetchImpl,
    })).rejects.toThrow('OPENAI_NF_MULTIPLE_ACCESS_KEYS')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
