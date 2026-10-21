import { describe, expect, it } from 'vitest'
import { configurarRuntimeRelatorios, fundoRelatoriosConfigurado, relatoriosPermitidos } from './relatorios-runtime'
import { callbackPreviewPermitido, callbackRelatoriosPermitido } from './relatorios-callback'
import { montarUrlCallback, origemCallback, prontidaoCallback } from './callback-admin.server'
import { configurarCapturaCallback } from './relatorios-callback-capture.server'
import { diagnosticoCarteiraPermitido } from './carteira-diagnostic'
import { processamentoEstoquePreviewPermitido } from './estoque-processamento.server'
import { processamentoInclusaoPreviewPermitido } from './inclusao-processamento.server'
import { rotinaRelatoriosPermitida } from './relatorios-rotina.server'

const fund = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const production = {
  VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main',
  NEXT_PUBLIC_SUPABASE_URL: 'https://wwsndnuvnjuabpbjwlck.supabase.co', INTEGRATION_RUNTIME_ENV: 'producao',
  VORTX_REPORTS_PRODUCTION_ENABLED: 'true', VORTX_REPORTS_PRODUCTION_FUNDO_ID: fund,
}
const preview = {
  VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'integration/vortx-main-20261021',
  NEXT_PUBLIC_SUPABASE_URL: 'https://phdckowbexkkvuwnzeaf.supabase.co',
  VORTX_REPORTS_PREVIEW_ENABLED: 'true', VORTX_REPORTS_PREVIEW_FUNDO_ID: other,
}
const callback = { ...production, VORTX_REPORT_CALLBACK_PRODUCTION_ENABLED: 'true',
  VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED: 'true',
  VORTX_REPORT_CALLBACK_BASE_URL: 'https://bw-antecipa.better-with.tech' }

describe('explicit Vortx production promotion boundaries', () => {
  it('is disabled by default', () => {
    expect(configurarRuntimeRelatorios({})).toBeNull()
    expect(relatoriosPermitidos(fund, {})).toBe(false)
  })
  it('selects the exact production project and configured Fund only', () => {
    expect(configurarRuntimeRelatorios(production)).toEqual({ ambiente: 'production', fundoId: fund })
    expect(relatoriosPermitidos(fund, production)).toBe(true)
    expect(relatoriosPermitidos(other, production)).toBe(false)
    expect(fundoRelatoriosConfigurado(production)).toBe(fund)
  })
  it.each(Object.keys(production))('fails closed for a missing or changed production field %s', key => {
    expect(configurarRuntimeRelatorios({ ...production, [key]: undefined })).toBeNull()
    expect(configurarRuntimeRelatorios({ ...production, [key]: 'wrong' })).toBeNull()
  })
  it('never promotes Preview flags or the Preview database into production', () => {
    expect(configurarRuntimeRelatorios({ ...preview, VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' })).toBeNull()
    expect(configurarRuntimeRelatorios({ ...production, NEXT_PUBLIC_SUPABASE_URL: preview.NEXT_PUBLIC_SUPABASE_URL })).toBeNull()
    expect(configurarRuntimeRelatorios({ ...production, NEXT_PUBLIC_SUPABASE_URL: 'https://fhgkmggthxikfpogrvaa.supabase.co' })).toBeNull()
    expect(configurarRuntimeRelatorios({ ...production, VERCEL_ENV: 'preview' })).toBeNull()
  })
  it('preserves the approved Preview with independent Fund selection', () => {
    expect(configurarRuntimeRelatorios({ ...production, ...preview })).toEqual({ ambiente: 'preview', fundoId: other })
    expect(relatoriosPermitidos(fund, preview)).toBe(false)
    expect(configurarRuntimeRelatorios({ ...preview, VERCEL_GIT_COMMIT_REF: 'homolog' })).toBeNull()
  })
  it('requires independent processing flags and a download allowlist', () => {
    expect(processamentoEstoquePreviewPermitido(production)).toBe(false)
    expect(processamentoInclusaoPreviewPermitido(production)).toBe(false)
    expect(rotinaRelatoriosPermitida(production)).toBe(false)
    const enabled = { ...production, VORTX_REPORT_STOCK_PROCESSING_ENABLED: 'true',
      VORTX_REPORT_INCLUSION_PROCESSING_ENABLED: 'true', VORTX_REPORTS_DAILY_ENABLED: 'true',
      VORTX_REPORT_DOWNLOAD_HOSTS: 'reports.example.invalid' }
    expect(processamentoEstoquePreviewPermitido(enabled)).toBe(true)
    expect(processamentoInclusaoPreviewPermitido(enabled)).toBe(true)
    expect(rotinaRelatoriosPermitida(enabled)).toBe(true)
    expect(processamentoEstoquePreviewPermitido({ ...enabled, VORTX_REPORT_DOWNLOAD_HOSTS: '' })).toBe(false)
    expect(processamentoInclusaoPreviewPermitido({ ...enabled, VORTX_REPORT_DOWNLOAD_HOSTS: '' })).toBe(false)
  })
  it('never accepts the temporary Preview callback risk exception in production', () => {
    expect(callbackRelatoriosPermitido(production)).toBe(false)
    expect(callbackRelatoriosPermitido({ ...callback, VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED: 'false',
      VORTX_REPORT_CALLBACK_URL_RISK_ACCEPTED: 'true' })).toBe(false)
    expect(callbackRelatoriosPermitido(callback)).toBe(true)
    expect(callbackRelatoriosPermitido({ ...callback, VORTX_REPORT_CALLBACK_PRODUCTION_ENABLED: 'false' })).toBe(false)
    expect(callbackPreviewPermitido({ ...callback, ...preview, VERCEL_ENV: 'production' })).toBe(false)
  })
  it('uses only the fixed production callback origin, never forwarded/Preview hosts', () => {
    expect(origemCallback(callback)).toBe('https://bw-antecipa.better-with.tech')
    expect(prontidaoCallback(callback)).toMatchObject({ habilitado: true, avisoRisco: null })
    const url = new URL(montarUrlCallback(fund, 'synthetic-secret', callback))
    expect(url.origin).toBe('https://bw-antecipa.better-with.tech')
    expect(url.searchParams.get('endpoint')).toBe(fund)
    expect(url.searchParams.get('token')).toBe('synthetic-secret')
    for (const base of ['https://other.example.invalid', 'http://bw-antecipa.better-with.tech',
      'https://bw-antecipa.better-with.tech/other', 'https://bw-antecipa.better-with.tech?token=bad',
      'https://user:pass@bw-antecipa.better-with.tech']) {
      expect(origemCallback({ ...callback, VORTX_REPORT_CALLBACK_BASE_URL: base })).toBeNull()
    }
  })
  it('keeps raw capture and wallet diagnostic tools Preview-only even with all diagnostic flags', () => {
    const env = { ...callback, VORTX_REPORTS_PREVIEW_ENABLED: 'true', VORTX_REPORTS_PREVIEW_FUNDO_ID: fund,
      VORTX_REPORT_CALLBACK_PREVIEW_ENABLED: 'true', VORTX_CARTEIRA_DIAGNOSTIC_ENABLED: 'true',
      VORTX_CARTEIRA_DIAGNOSTIC_FUNDO_ID: fund, VORTX_REPORT_CALLBACK_RAW_CAPTURE_ID: fund,
      VORTX_REPORT_CALLBACK_RAW_ENDPOINT_ID: fund, VORTX_REPORT_CALLBACK_RAW_CAPTURE_UNTIL: new Date(Date.now() + 60000).toISOString() }
    expect(configurarCapturaCallback(new Request(`https://bw-antecipa.better-with.tech/api/integracoes/vortx/relatorios/callback?endpoint=${fund}`, { method: 'POST' }), env)).toBeNull()
    expect(diagnosticoCarteiraPermitido(fund, env)).toBe(false)
  })
})
