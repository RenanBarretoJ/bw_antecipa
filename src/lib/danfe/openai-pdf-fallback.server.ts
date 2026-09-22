import 'server-only'

import { z } from 'zod'

const DEFAULT_MODEL = 'gpt-5.4-2026-03-05'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MIN_CONFIDENCE = 0.8

const aiDanfeSchema = z.object({
  document_type: z.enum(['nfe_danfe', 'other', 'uncertain']),
  numero_nf: z.string().max(20).nullable(),
  serie: z.string().max(10).nullable(),
  chave_acesso: z.string().max(80).nullable(),
  chaves_acesso_candidatas: z.array(z.string().max(80)).max(5),
  cnpj_emitente: z.string().max(30).nullable(),
  cnpj_destinatario: z.string().max(30).nullable(),
  razao_social_destinatario: z.string().max(160).nullable(),
  data_emissao: z.string().max(20).nullable(),
  data_vencimento: z.string().max(20).nullable(),
  valor_total_nota: z.number().finite().positive().nullable(),
  confidence: z.number().finite().min(0).max(1),
}).strict()

type AiDanfe = z.infer<typeof aiDanfeSchema>

type ResponsesEnvelope = {
  output_text?: string
  output?: Array<{
    content?: Array<{ type?: string; text?: string; refusal?: string }>
  }>
}

type FetchLike = typeof fetch
type AiFallbackEnv = Partial<Record<string, string | undefined>>

export type AiPdfFallbackResult = {
  text: string
  confidence: number
  durationMs: number
  fallbackTriggerReason: 'NO_TEXT_LAYER' | 'TEXT_INSUFFICIENT' | 'MISSING_CORE_ANCHORS' | 'NATIVE_EXTRACTION_FAILED'
}

type AiPdfFallbackOptions = {
  env?: AiFallbackEnv
  fetchImpl?: FetchLike
  timeoutMs?: number
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    document_type: { type: 'string', enum: ['nfe_danfe', 'other', 'uncertain'] },
    numero_nf: { type: ['string', 'null'] },
    serie: { type: ['string', 'null'] },
    chave_acesso: { type: ['string', 'null'] },
    chaves_acesso_candidatas: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    cnpj_emitente: { type: ['string', 'null'] },
    cnpj_destinatario: { type: ['string', 'null'] },
    razao_social_destinatario: { type: ['string', 'null'] },
    data_emissao: { type: ['string', 'null'] },
    data_vencimento: { type: ['string', 'null'] },
    valor_total_nota: { type: ['number', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: [
    'document_type',
    'numero_nf',
    'serie',
    'chave_acesso',
    'chaves_acesso_candidatas',
    'cnpj_emitente',
    'cnpj_destinatario',
    'razao_social_destinatario',
    'data_emissao',
    'data_vencimento',
    'valor_total_nota',
    'confidence',
  ],
} as const

const EXTRACTION_PROMPT = `Extraia exclusivamente os dados visiveis deste DANFE brasileiro de NF-e.
Nao complete, corrija, calcule ou infira caracteres ausentes. Use null quando um campo nao estiver legivel.
- chave_acesso: exatamente os 44 digitos impressos no DANFE; nao repare digito verificador.
- chaves_acesso_candidatas: todas as leituras plausiveis de 44 digitos para a chave, sem inventar alternativas.
- numero_nf e serie: valores da NF-e, sem pontuacao.
- CNPJs: somente os 14 digitos, distinguindo emitente e destinatario/remetente.
- razao_social_destinatario: nome empresarial visivel do destinatario/remetente; use null se nao estiver legivel.
- datas: formato YYYY-MM-DD.
- data_vencimento: ultimo vencimento explicitamente exibido, quando houver parcelas.
- valor_total_nota: somente o campo canonico VALOR TOTAL DA NOTA; nao use total de produtos, impostos, duplicatas ou valor liquido.
Se houver mais de uma NF, se o documento nao for DANFE de NF-e ou se a leitura for conflitante, use document_type=uncertain.
confidence deve representar a confianca no conjunto dos campos, entre 0 e 1.`

function enabled(env: AiFallbackEnv): boolean {
  return env.OPENAI_NF_FALLBACK_ENABLED?.trim().toLowerCase() !== 'false'
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function onlyDigits(value: string | null, expectedLength?: number): string | undefined {
  if (!value) return undefined
  const digits = value.replace(/\D/g, '')
  if (!digits || (expectedLength && digits.length !== expectedLength)) return undefined
  return digits
}

function validNfeKey(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false
  let sum = 0
  let weight = 2
  for (let index = 42; index >= 0; index -= 1) {
    sum += Number(key[index]) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const remainder = sum % 11
  return Number(key[43]) === (remainder < 2 ? 0 : 11 - remainder)
}

function validIsoDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value
    : undefined
}

function brDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function brMoney(value: number | null): string | undefined {
  if (value === null || !Number.isFinite(value) || value <= 0) return undefined
  const [integer, decimal] = value.toFixed(2).split('.')
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimal}`
}

function responseText(payload: ResponsesEnvelope): string | undefined {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) return content.text
    }
  }
  return undefined
}

function assertCandidateCoherence(candidate: AiDanfe): void {
  const key = onlyDigits(candidate.chave_acesso, 44)
  if (!key) return

  const issueDate = validIsoDate(candidate.data_emissao)
  const keyYearMonth = `20${key.slice(2, 6)}`

  if (issueDate && issueDate.slice(0, 7).replace('-', '') !== keyYearMonth) {
    throw new Error('OPENAI_NF_DATE_KEY_CONFLICT')
  }
}

function assertRequiredFiscalFields(candidate: AiDanfe): void {
  if (!validIsoDate(candidate.data_emissao)) throw new Error('OPENAI_NF_ISSUE_DATE_MISSING')
  if (!brMoney(candidate.valor_total_nota)) throw new Error('OPENAI_NF_TOTAL_MISSING')
}

function resolveValidatedAccessKey(candidate: AiDanfe): AiDanfe {
  const keys = [candidate.chave_acesso, ...candidate.chaves_acesso_candidatas]
    .map((value) => onlyDigits(value, 44))
    .filter((value): value is string => Boolean(value && validNfeKey(value)))
  const unique = [...new Set(keys)]
  if (unique.length === 0) throw new Error('OPENAI_NF_ACCESS_KEY_INVALID')
  if (unique.length > 1) throw new Error('OPENAI_NF_MULTIPLE_ACCESS_KEYS')
  return { ...candidate, chave_acesso: unique[0] }
}

function retryableExtractionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return new Set([
    'OPENAI_NF_TEMPORARILY_UNAVAILABLE',
    'OPENAI_NF_EMPTY_RESPONSE',
    'OPENAI_NF_INVALID_RESPONSE',
    'OPENAI_NF_DOCUMENT_UNCERTAIN',
    'OPENAI_NF_LOW_CONFIDENCE',
    'OPENAI_NF_ACCESS_KEY_INVALID',
    'OPENAI_NF_DATE_KEY_CONFLICT',
    'OPENAI_NF_ISSUE_DATE_MISSING',
    'OPENAI_NF_TOTAL_MISSING',
    'OPENAI_NF_NO_RELIABLE_FIELDS',
  ]).has(error.message)
}

/**
 * Transforma somente campos estruturados em texto canonico para que o parser
 * deterministico P12 continue sendo a autoridade sobre validacao e persistencia.
 */
export function composeAiDanfeText(input: AiDanfe): string {
  const key = onlyDigits(input.chave_acesso, 44)
  const issuer = onlyDigits(input.cnpj_emitente, 14)
  const recipient = onlyDigits(input.cnpj_destinatario, 14)
  const number = onlyDigits(input.numero_nf)?.slice(-9)
  const series = onlyDigits(input.serie)?.slice(-3)
  const issueDate = validIsoDate(input.data_emissao)
  const dueDate = validIsoDate(input.data_vencimento)
  const total = brMoney(input.valor_total_nota)
  const recipientName = input.razao_social_destinatario?.replace(/[\r\n]+/g, ' ').trim().slice(0, 120)
  const lines = ['IDENTIFICACAO DO EMITENTE']

  // Quando ha chave, numero, serie e emitente sao derivados dela pelo parser
  // deterministico. Os campos visuais equivalentes nao podem sobrepor a chave.
  if (key) lines.push(`CHAVE DE ACESSO ${key}`)
  else {
    if (issuer) lines.push(`CNPJ ${issuer}`)
    if (number) lines.push(`NF-e N. ${number}`)
    if (series) lines.push(`SERIE ${series}`)
  }
  lines.push('DESTINATARIO / REMETENTE')
  if (recipientName && recipient) lines.push(`${recipientName} ${recipient}`)
  else if (recipient) lines.push(`CNPJ ${recipient}`)
  if (issueDate) lines.push(`DATA DE EMISSAO ${brDate(issueDate)}`)
  if (dueDate) lines.push(`VENCIMENTO ${brDate(dueDate)}`)
  if (total) lines.push(`VALOR TOTAL DA NOTA R$ ${total}`)
  const canonicalNumber = key ? String(Number(key.slice(25, 34))) : number
  if (canonicalNumber && dueDate && total) lines.push(`${canonicalNumber}-01/01 ${brDate(dueDate)} ${total} |`)
  return lines.join('\n')
}

export async function extractDanfeWithOpenAi(
  buffer: Buffer,
  reason: AiPdfFallbackResult['fallbackTriggerReason'],
  options: AiPdfFallbackOptions = {},
): Promise<AiPdfFallbackResult> {
  const env = options.env || process.env
  if (!enabled(env)) throw new Error('OPENAI_NF_FALLBACK_DISABLED')
  const apiKey = env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error('OPENAI_NF_NOT_CONFIGURED')
  if (!buffer.length || buffer.length > 50 * 1024 * 1024) throw new Error('OPENAI_NF_FILE_SIZE_INVALID')

  const model = env.OPENAI_NF_MODEL?.trim() || DEFAULT_MODEL
  const timeoutMs = options.timeoutMs ?? boundedNumber(env.OPENAI_NF_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 5_000, 60_000)
  const minConfidence = boundedNumber(env.OPENAI_NF_MIN_CONFIDENCE, DEFAULT_MIN_CONFIDENCE, 0.5, 1)
  const fetchImpl = options.fetchImpl || fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const started = performance.now()

  try {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const prompt = attempt === 0
          ? EXTRACTION_PROMPT
          : `${EXTRACTION_PROMPT}\nRefaca a leitura da chave de acesso com atencao caractere por caractere e inclua todas as alternativas realmente visiveis.`
        const response = await fetchImpl('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            store: false,
            input: [{
              role: 'user',
              content: [
                {
                  type: 'input_file',
                  filename: 'nota-fiscal.pdf',
                  file_data: `data:application/pdf;base64,${buffer.toString('base64')}`,
                  detail: 'high',
                },
                { type: 'input_text', text: prompt },
              ],
            }],
            text: {
              format: {
                type: 'json_schema',
                name: 'danfe_nfe_extraction',
                strict: true,
                schema: RESPONSE_SCHEMA,
              },
            },
            max_output_tokens: 900,
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) throw new Error('OPENAI_NF_AUTH_FAILED')
          if (response.status === 408 || response.status === 429 || response.status >= 500) throw new Error('OPENAI_NF_TEMPORARILY_UNAVAILABLE')
          throw new Error('OPENAI_NF_REQUEST_FAILED')
        }

        const payload = await response.json() as ResponsesEnvelope
        const output = responseText(payload)
        if (!output) throw new Error('OPENAI_NF_EMPTY_RESPONSE')

        let candidate: AiDanfe
        try {
          candidate = aiDanfeSchema.parse(JSON.parse(output))
        } catch {
          throw new Error('OPENAI_NF_INVALID_RESPONSE')
        }
        if (candidate.document_type !== 'nfe_danfe') throw new Error('OPENAI_NF_DOCUMENT_UNCERTAIN')
        if (candidate.confidence < minConfidence) throw new Error('OPENAI_NF_LOW_CONFIDENCE')
        candidate = resolveValidatedAccessKey(candidate)
        assertCandidateCoherence(candidate)
        assertRequiredFiscalFields(candidate)

        const text = composeAiDanfeText(candidate)
        if (text.split('\n').length <= 2) throw new Error('OPENAI_NF_NO_RELIABLE_FIELDS')
        return {
          text,
          confidence: candidate.confidence,
          durationMs: Math.round(performance.now() - started),
          fallbackTriggerReason: reason,
        }
      } catch (error) {
        lastError = error
        if (attempt === 0 && retryableExtractionError(error)) continue
        throw error
      }
    }
    throw lastError
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('OPENAI_NF_TIMEOUT')
    if (error instanceof Error && /^OPENAI_NF_[A-Z0-9_]+$/.test(error.message)) throw error
    throw new Error('OPENAI_NF_REQUEST_FAILED')
  } finally {
    clearTimeout(timeout)
  }
}
