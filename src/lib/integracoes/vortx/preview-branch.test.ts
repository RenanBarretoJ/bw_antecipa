import { describe, expect, it } from 'vitest'
import { relatoriosPreviewPermitidos } from './relatorios-operacao'
import { diagnosticoCarteiraPermitido } from './carteira-diagnostic'

describe('Vortx integration remains bound to the existing isolated Preview', () => {
  const fundoId = '00000000-0000-4000-8000-000000000001'
  const env = {
    VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'integration/vortx-main-20261021',
    NEXT_PUBLIC_SUPABASE_URL: 'https://phdckowbexkkvuwnzeaf.supabase.co',
    VORTX_REPORTS_PREVIEW_ENABLED: 'true', VORTX_REPORTS_PREVIEW_FUNDO_ID: fundoId,
    VORTX_CARTEIRA_DIAGNOSTIC_ENABLED: 'true', VORTX_CARTEIRA_DIAGNOSTIC_FUNDO_ID: fundoId,
  }
  it.each([relatoriosPreviewPermitidos, diagnosticoCarteiraPermitido])('permits both approved branches only in the same Preview/Fund', guard => {
    expect(guard(fundoId, env)).toBe(true)
    expect(guard(fundoId, { ...env, VERCEL_GIT_COMMIT_REF: 'feature/vortx-real-data-preview' })).toBe(true)
    expect(guard('00000000-0000-4000-8000-000000000002', env)).toBe(false)
    for (const patch of [
      { VERCEL_ENV: 'production' }, { VERCEL_GIT_COMMIT_REF: 'main' },
      { VERCEL_GIT_COMMIT_REF: 'homolog' }, { VERCEL_GIT_COMMIT_REF: 'other-preview' },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://wwsndnuvnjuabpbjwlck.supabase.co' },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://fhgkmggthxikfpogrvaa.supabase.co' },
      { VORTX_REPORTS_PREVIEW_ENABLED: 'false', VORTX_CARTEIRA_DIAGNOSTIC_ENABLED: 'false' },
    ]) expect(guard(fundoId, { ...env, ...patch })).toBe(false)
  })
})
