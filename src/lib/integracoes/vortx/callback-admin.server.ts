import 'server-only'
import { callbackRelatoriosPermitido, CALLBACK_PATH } from './relatorios-callback'
import { configurarRuntimeRelatorios } from './relatorios-runtime'

/** Origin comes only from a branch-scoped server setting, never Host/forwarded headers or form data. */
export function origemCallback(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  try {
    const url = new URL(env.VORTX_REPORT_CALLBACK_BASE_URL ?? '')
    if (configurarRuntimeRelatorios(env)?.ambiente === 'production') {
      return url.origin === 'https://bw-antecipa.better-with.tech'
        && env.VORTX_REPORT_CALLBACK_BASE_URL === url.origin
        && !url.username && !url.password && !url.search && !url.hash
        && url.pathname === '/' ? url.origin : null
    }
    const host = env.VERCEL_BRANCH_URL
    return host && url.protocol === 'https:' && url.hostname.endsWith('.vercel.app')
      && url.host === host && url.origin === env.VORTX_REPORT_CALLBACK_BASE_URL
      && !url.username && !url.password && !url.search && !url.hash ? url.origin : null
  } catch { return null }
}
export function prontidaoCallback(env: Readonly<Record<string, string | undefined>> = process.env) {
  const habilitado = callbackRelatoriosPermitido(env) && origemCallback(env) !== null
  const avisoProducao = 'Aceite de risco autorizado em produção: a URL contém um segredo que pode aparecer nos logs da hospedagem. O mascaramento não foi comprovado. Compartilhe apenas com a Vórtx por canal privado, restrinja o acesso aos logs e rotacione a URL em caso de exposição.'
  const avisoRisco = habilitado && env.VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED !== 'true'
    ? configurarRuntimeRelatorios(env)?.ambiente === 'production' ? avisoProducao
      : 'Exceção autorizada somente nesta Preview: a URL contém um segredo que pode aparecer nos logs da hospedagem. O mascaramento não foi comprovado. Compartilhe apenas com a Vórtx por canal privado e revogue o recebimento ao concluir os testes.' : null
  return { habilitado, avisoRisco, bloqueio: habilitado ? null : 'A geração depende da liberação técnica do endereço público e da proteção do segredo nos logs deste ambiente.' }
}
export function montarUrlCallback(id: string, segredo: string, env: Readonly<Record<string, string | undefined>> = process.env) {
  const origin = origemCallback(env)
  if (!origin || !callbackRelatoriosPermitido(env)) throw new Error('CALLBACK_NOT_READY')
  const url = new URL(CALLBACK_PATH, origin)
  url.searchParams.set('endpoint', id); url.searchParams.set('token', segredo)
  return url.toString()
}
