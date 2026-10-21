import { afterEach, describe, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ rpc }) }))
import { criarRepositorioCallbackRelatorio } from './relatorios-callback-repository.server'

afterEach(() => { vi.unstubAllEnvs(); rpc.mockReset() })

describe('production callback repository environment isolation', () => {
  it.each(['producao','homologacao'] as const)('validates the bound provider environment %s after secret verification', async ambiente => {
    const fund = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    for (const [key,value] of Object.entries({VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main',
      NEXT_PUBLIC_SUPABASE_URL:'https://wwsndnuvnjuabpbjwlck.supabase.co',INTEGRATION_RUNTIME_ENV:'producao',
      VORTX_REPORTS_PRODUCTION_ENABLED:'true',VORTX_REPORTS_PRODUCTION_FUNDO_ID:fund})) vi.stubEnv(key,value)
    const binding = {status:'AUTHORIZED',endpointId:fund,fundoId:fund,ambiente,codigoCarteira:'synthetic-wallet',revisao:1}
    rpc.mockResolvedValue({data:binding,error:null})
    const result=await criarRepositorioCallbackRelatorio().autorizar(fund,'a'.repeat(64))
    expect(result).toEqual(ambiente==='producao'?binding:{status:'UNAUTHORIZED'})
    expect(rpc).toHaveBeenCalledExactlyOnceWith('vortx_autorizar_callback',{p_id:fund,p_segredo_hash:'a'.repeat(64)})
  })
})
