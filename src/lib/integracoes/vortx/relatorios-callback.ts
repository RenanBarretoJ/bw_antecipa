import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { CODIGO_CARTEIRA_PATTERN } from '../configuracao-vortx-vrs'
import { relatoriosPreviewPermitidos } from './relatorios-operacao'
import { normalizarTipoCallbackVortx, relatorioDePosicao, TIPOS_RELATORIO_VORTX } from './relatorios-tipos'

export const CALLBACK_MAX_BODY = 16 * 1024
export const CALLBACK_PATH = '/api/integracoes/vortx/relatorios/callback'
const tipoSchema = z.string().max(80).transform(normalizarTipoCallbackVortx).pipe(z.enum(TIPOS_RELATORIO_VORTX))
const linkSchema = z.string().min(1).max(8192).refine(value => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
  } catch { return false }
}, 'URL de relatorio invalida')
const eventSchema = z.object({
  tipoWebhook: z.literal('statusRelatorio').optional(),
  idRelatorio: z.uuid().transform(value => value.toLowerCase()),
  idCarteira: z.string().trim().regex(CODIGO_CARTEIRA_PATTERN),
  tipoRelatorio: tipoSchema,
  dataReferencia: z.iso.date(), dataInicio: z.iso.date().nullish(), dataFim: z.iso.date().nullish(),
  statusRelatorio: z.enum(['Em geração', 'Disponível', 'Expirado']),
  urlRelatorio: linkSchema.nullish().transform(value => value ?? null),
  dataExpiracao: z.iso.datetime({ offset: true }).nullish().transform(value => value ? new Date(value).toISOString() : null),
}).strict().refine(value => relatorioDePosicao(value.tipoRelatorio)
  || Boolean(value.dataInicio && value.dataFim && value.dataFim >= value.dataInicio))
  .refine(value => value.statusRelatorio !== 'Disponível' || Boolean(value.urlRelatorio && value.dataExpiracao))
  .transform(value => {
    const posicao = relatorioDePosicao(value.tipoRelatorio)
    return { idRelatorio: value.idRelatorio, idCarteira: value.idCarteira, tipoRelatorio: value.tipoRelatorio,
      dataReferencia: value.dataReferencia, dataInicio: posicao ? value.dataReferencia : value.dataInicio!,
      dataFim: posicao ? value.dataReferencia : value.dataFim!, statusRelatorio: value.statusRelatorio,
      urlRelatorio: value.urlRelatorio, dataExpiracao: value.dataExpiracao }
  })

export type EventoRelatorioVortx = z.output<typeof eventSchema>
export type MetadadosCallback = Omit<EventoRelatorioVortx, 'urlRelatorio'> & { urlHash: string | null }
export type CallbackBinding = { endpointId: string; fundoId: string; ambiente: 'producao' | 'homologacao'; codigoCarteira: string; revisao: number }
export function interpretarCallbackRelatorio(value: unknown): EventoRelatorioVortx {
  const parsed = eventSchema.safeParse(value)
  if (!parsed.success) throw new Error('Callback de relatorio invalido.')
  return parsed.data
}
export function hashSegredoCallback(value: string) { return createHash('sha256').update(value).digest('hex') }

/** Server tooling only. The secret must be handed off privately, never logged. */
export function gerarSegredoCallback() {
  const segredo = randomBytes(32).toString('hex')
  return { segredo, hash: hashSegredoCallback(segredo) }
}

export function prepararEventoCallback(endpointId: string, evento: EventoRelatorioVortx) {
  const { urlRelatorio, ...rest } = evento
  const metadados: MetadadosCallback = { ...rest, urlHash: urlRelatorio ? hashSegredoCallback(urlRelatorio) : null }
  const hash = hashSegredoCallback(['VORTX_RELATORIO_CALLBACK_V1', endpointId,
    metadados.idRelatorio, metadados.idCarteira, metadados.tipoRelatorio, metadados.statusRelatorio,
    metadados.dataReferencia, metadados.dataInicio, metadados.dataFim,
    metadados.dataExpiracao ?? '', metadados.urlHash ?? ''].join('|'))
  return { metadados, hash }
}

export function callbackPreviewPermitido(env: Readonly<Record<string, string | undefined>> = process.env) {
  return z.uuid().safeParse(env.VORTX_REPORTS_PREVIEW_FUNDO_ID).success
    && relatoriosPreviewPermitidos(env.VORTX_REPORTS_PREVIEW_FUNDO_ID ?? '', env)
    && env.VORTX_REPORT_CALLBACK_PREVIEW_ENABLED === 'true'
    // Temporary, operator-authorized Preview exception; this is NOT proof of log redaction.
    && (env.VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED === 'true'
      || env.VORTX_REPORT_CALLBACK_URL_RISK_ACCEPTED === 'true')
}
