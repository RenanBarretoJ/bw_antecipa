import { z } from 'zod'
import { branchPreviewVortxPermitida } from './preview-branch'

type Environment = Readonly<Record<string, string | undefined>>
type RelatoriosRuntime = { ambiente: 'preview' | 'production'; fundoId: string }

/** Environment selection is not authorization: RPCs still validate actor, Fund,
 * published provider version, capability, wallet and credential on every call. */
export function configurarRuntimeRelatorios(env: Environment = process.env): RelatoriosRuntime | null {
  if (env.VERCEL_ENV === 'preview') {
    const fundo = z.uuid().safeParse(env.VORTX_REPORTS_PREVIEW_FUNDO_ID)
    return fundo.success && branchPreviewVortxPermitida(env.VERCEL_GIT_COMMIT_REF)
      && env.NEXT_PUBLIC_SUPABASE_URL === 'https://phdckowbexkkvuwnzeaf.supabase.co'
      && env.VORTX_REPORTS_PREVIEW_ENABLED === 'true'
      ? { ambiente: 'preview', fundoId: fundo.data } : null
  }
  if (env.VERCEL_ENV === 'production') {
    const fundo = z.uuid().safeParse(env.VORTX_REPORTS_PRODUCTION_FUNDO_ID)
    return fundo.success && env.VERCEL_GIT_COMMIT_REF === 'main'
      && env.NEXT_PUBLIC_SUPABASE_URL === 'https://wwsndnuvnjuabpbjwlck.supabase.co'
      && env.INTEGRATION_RUNTIME_ENV === 'producao'
      && env.VORTX_REPORTS_PRODUCTION_ENABLED === 'true'
      ? { ambiente: 'production', fundoId: fundo.data } : null
  }
  return null
}

export function fundoRelatoriosConfigurado(env: Environment = process.env): string | null {
  return configurarRuntimeRelatorios(env)?.fundoId ?? null
}

export function relatoriosPermitidos(fundoId: string, env: Environment = process.env): boolean {
  return configurarRuntimeRelatorios(env)?.fundoId === fundoId
}
