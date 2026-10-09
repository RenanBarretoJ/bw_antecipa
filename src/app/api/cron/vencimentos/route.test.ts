import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(()=>({create:vi.fn(),notify:vi.fn(),audit:vi.fn()}))
vi.mock('@supabase/supabase-js',()=>({createClient:m.create}))
vi.mock('@/lib/actions/notificacao',()=>({notificarEntidade:m.notify}))
vi.mock('@/lib/actions/auditoria',()=>({registrarLog:m.audit}))
function fixture(){
  const update=vi.fn().mockReturnValue({eq:vi.fn().mockResolvedValue({error:null})})
  const from=vi.fn().mockReturnValue({select:()=>({eq:async()=>({data:[
    {id:'op-a',data_vencimento:'2026-10-11',cedente_id:'c',cedentes:{razao_social:'QA'}},
    {id:'op-b',data_vencimento:'2026-10-07',cedente_id:'c',cedentes:{razao_social:'QA'}},
    {id:'op-c',data_vencimento:'2026-10-05',cedente_id:'c',cedentes:{razao_social:'QA'}},
  ],error:null})}),update})
  m.create.mockReturnValue({from})
  m.notify.mockResolvedValue({success:true,criadas:1})
  return {from,update}
}
describe('vencimentos notification routing',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-06T12:00:00Z'))
    vi.stubEnv('CRON_SECRET','qa-test-only');vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://127.0.0.1:59421');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','qa-test-only')
    vi.spyOn(console,'log').mockImplementation(()=>{})
  })
  afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.restoreAllMocks()})
  it('sends each alert using its operation, even when the cedente is the same',async()=>{
    const f=fixture();const {GET}=await import('./route')
    const response=await GET(new Request('http://localhost/api/cron/vencimentos',{headers:{authorization:'Bearer qa-test-only'}}))
    expect(await response.json()).toMatchObject({alertas_d5:1,alertas_d1:1,inadimplentes:1,erros:0})
    expect(m.notify).toHaveBeenCalledTimes(6)
    expect(m.notify.mock.calls.map(([ctx,role])=>[ctx.entidadeId,role])).toEqual([
      ['op-a','cedente'],['op-a','sacado'],['op-b','cedente'],['op-b','gestor'],['op-c','gestor'],['op-c','cedente'],
    ])
    for(const [ctx,,,,tipo,key] of m.notify.mock.calls){
      expect(ctx.entidadeTipo).toBe('operacao');expect(key).toContain(ctx.entidadeId);expect(key).toContain(tipo)
    }
    expect(f.from.mock.calls.every(([table])=>table==='operacoes')).toBe(true)
    expect(f.update).toHaveBeenCalledExactlyOnceWith({status:'inadimplente'})
    expect(m.audit).toHaveBeenCalledTimes(1)
  })
  it('counts rejected notifications without a global fallback or changing the business outcome',async()=>{
    fixture();m.notify.mockResolvedValue({success:false});const {GET}=await import('./route')
    const response=await GET(new Request('http://localhost/api/cron/vencimentos',{headers:{authorization:'Bearer qa-test-only'}}))
    expect(await response.json()).toMatchObject({erros:6,inadimplentes:1});expect(m.notify).toHaveBeenCalledTimes(6)
  })
  it('rejects unauthenticated calls before any query or notification',async()=>{
    fixture();const {GET}=await import('./route');expect((await GET(new Request('http://localhost/api/cron/vencimentos'))).status).toBe(401)
    expect(m.create).not.toHaveBeenCalled();expect(m.notify).not.toHaveBeenCalled()
  })
})
