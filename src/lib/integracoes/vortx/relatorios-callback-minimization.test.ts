import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarRepositorioCallbackRelatorio } from './relatorios-callback-repository.server'
import { receberCallbackRelatorio } from './relatorios-callback-handler.server'

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', token='a'.repeat(64)
const binding={endpointId:id,fundoId:id,ambiente:'producao' as const,codigoCarteira:'qa-wallet',revisao:1}
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()})
describe('retired callback diagnostics in the real application adapter',()=>{
  it.each(['{',JSON.stringify({idCarteira:'qa-wallet',raw:'synthetic-private-json'})])('retains no rejected JSON even when old capture flags remain set: %s',async body=>{
    vi.stubEnv('VORTX_REPORT_CALLBACK_CAPTURE_UNTIL',new Date(Date.now()+3600000).toISOString())
    const rpc=vi.fn()
    const repo=criarRepositorioCallbackRelatorio({rpc} as unknown as Parameters<typeof criarRepositorioCallbackRelatorio>[0])
    vi.spyOn(repo,'autorizar').mockResolvedValue({status:'AUTHORIZED',...binding})
    expect(repo.diagnosticarRejeicao).toBeUndefined()
    const response=await receberCallbackRelatorio(new Request(`https://example.invalid/callback?endpoint=${id}&token=${token}`,{
      method:'POST',headers:{'content-type':'application/json'},body,
    }),repo,id)
    expect(response.status).toBe(400);expect(await response.text()).toBe('');expect(rpc).not.toHaveBeenCalled()
  })
  it('does not send source body to the persistence adapter',async()=>{
    const persistir=vi.fn(),body=JSON.stringify({idRelatorio:id,idCarteira:'qa-wallet',tipoRelatorio:'posicao ativo',
      dataReferencia:'2026-10-19',dataInicio:'1900-01-01',dataFim:'1900-01-01',statusRelatorio:'Em geração',urlRelatorio:null,dataExpiracao:null})
    const response=await receberCallbackRelatorio(new Request(`https://example.invalid/callback?endpoint=${id}&token=${token}`,{
      method:'POST',headers:{'content-type':'application/json'},body,
    }),{autorizar:vi.fn().mockResolvedValue({status:'AUTHORIZED',...binding}),persistir},id)
    expect(response.status).toBe(200);expect(persistir.mock.calls[0]).toHaveLength(3)
    expect(JSON.stringify(persistir.mock.calls[0])).not.toContain('1900-01-01')
  })
})
