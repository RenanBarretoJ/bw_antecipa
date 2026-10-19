import 'server-only'
import { callbackPreviewPermitido, CALLBACK_PATH } from './relatorios-callback'

/** Origin comes only from a branch-scoped server setting, never Host/forwarded headers or form data. */
export function origemCallback(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  try {
    const url = new URL(env.VORTX_REPORT_CALLBACK_BASE_URL ?? '')
    const host = env.VERCEL_BRANCH_URL
    return host && url.protocol === 'https:' && url.hostname.endsWith('.vercel.app')
      && url.host === host && url.origin === env.VORTX_REPORT_CALLBACK_BASE_URL
      && !url.username && !url.password && !url.search && !url.hash ? url.origin : null
  } catch { return null }
}
export function prontidaoCallback(env: Readonly<Record<string, string | undefined>> = process.env) {
  const habilitado = callbackPreviewPermitido(env) && origemCallback(env) !== null
  return { habilitado, bloqueio: habilitado ? null : 'A geração depende da liberação técnica do endereço público e da proteção do segredo nos logs desta Preview.' }
}
export function montarUrlCallback(id: string, segredo: string, env: Readonly<Record<string, string | undefined>> = process.env) {
  const origin = origemCallback(env)
  if (!origin || !callbackPreviewPermitido(env)) throw new Error('CALLBACK_NOT_READY')
  const url = new URL(CALLBACK_PATH, origin)
  url.searchParams.set('endpoint', id); url.searchParams.set('token', segredo)
  return url.toString()
}
