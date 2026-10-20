import { callbackPreviewPermitido, hashSegredoCallback, type CallbackBinding } from './relatorios-callback'

export type CallbackRejection = { motivo: 'JSON_INVALIDO' | 'CONTRATO_INVALIDO'; corpo: string; bytes: number }
const DAY_MS = 24 * 60 * 60 * 1000

/** Temporary opt-in. Never enabled by the callback logging-risk exception alone. */
export function prazoCapturaCallback(env: Readonly<Record<string, string | undefined>> = process.env, now = Date.now()): string | null {
  if (!callbackPreviewPermitido(env)) return null
  const raw = env.VORTX_REPORT_CALLBACK_CAPTURE_UNTIL
  if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw)) return null
  const until = Date.parse(raw)
  return Number.isFinite(until) && until > now && until - now <= DAY_MS ? new Date(until).toISOString() : null
}

/** No Request, URL, headers or exception is accepted here. Signed report URLs remain inside encryption only. */
export function prepararDiagnosticoCallback(binding: CallbackBinding, rejection: CallbackRejection, token: string) {
  const corpo = rejection.corpo.replaceAll(token, '[CALLBACK_TOKEN_REDACTED]')
  const hash = hashSegredoCallback(JSON.stringify([binding.endpointId, binding.revisao, rejection.motivo, corpo]))
  return { hash, envelope: { purpose: 'VORTX_CALLBACK_REJEITADO_V1', ...binding, ...rejection, corpo, hash } }
}
