import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { composeAiDanfeText, extractDanfeWithOpenAi } from './openai-pdf-fallback.server'
import { extractDanfeFromText, validarDanfeParaPersistencia } from '../pdf-nf-parser'

const ACCESS_KEY = '29260912345678000195550020001548061123456780'

const candidate = {
  document_type: 'nfe_danfe' as const,
  numero_nf: '154806',
  serie: '2',
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
      expect(body).toMatchObject({ model: 'gpt-5.4-2026-03-05', store: false, max_output_tokens: 900 })
      expect(JSON.stringify(body)).toContain('"detail":"high"')
      expect(JSON.stringify(body)).toContain('"strict":true')
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
})
