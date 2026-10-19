import { describe, expect, it } from 'vitest'
import { carteiraDiagnosticSchema, diagnosticoCarteiraPermitido } from './carteira-diagnostic'

const fundoId = '0df93349-4244-4398-b9a8-db1c036dae7a'
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/vortx-real-data-preview', NEXT_PUBLIC_SUPABASE_URL: 'https://phdckowbexkkvuwnzeaf.supabase.co', VORTX_CARTEIRA_DIAGNOSTIC_ENABLED: 'true', VORTX_CARTEIRA_DIAGNOSTIC_FUNDO_ID: fundoId }
describe('isolamento temporario do diagnostico Carteira', () => {
  it('permite somente a Preview, branch, banco e Fundo autorizados', () => expect(diagnosticoCarteiraPermitido(fundoId, env)).toBe(true))
  it.each([
    ['VERCEL_ENV', 'production'], ['VERCEL_ENV', 'development'],
    ['VERCEL_GIT_COMMIT_REF', 'homolog'], ['VERCEL_GIT_COMMIT_REF', 'main'],
    ['NEXT_PUBLIC_SUPABASE_URL', 'https://wwsndnuvnjuabpbjwlck.supabase.co'],
    ['NEXT_PUBLIC_SUPABASE_URL', 'https://fhgkmggthxikfpogrvaa.supabase.co'],
    ['VORTX_CARTEIRA_DIAGNOSTIC_ENABLED', 'false'], ['VORTX_CARTEIRA_DIAGNOSTIC_FUNDO_ID', ''],
  ])('nega %s=%s', (key, value) => expect(diagnosticoCarteiraPermitido(fundoId, { ...env, [key]: value })).toBe(false))
  it('nega outro Fundo', () => expect(diagnosticoCarteiraPermitido('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', env)).toBe(false))
  it('rejeita URL, token, CNPJ ou campos arbitrarios do cliente', () => {
    expect(carteiraDiagnosticSchema.safeParse({ fundoId, dataCarteira: '2026-10-16', mfaCode: '123456', url: 'https://outro.test' }).success).toBe(false)
  })
  it('rejeita data impossivel e MFA ausente', () => {
    expect(carteiraDiagnosticSchema.safeParse({ fundoId, dataCarteira: '2026-02-30', mfaCode: '123456' }).success).toBe(false)
    expect(carteiraDiagnosticSchema.safeParse({ fundoId, dataCarteira: '2026-10-16' }).success).toBe(false)
  })
})
