import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
const {enabled,run}=vi.hoisted(()=>({enabled:vi.fn(),run:vi.fn()}))
vi.mock('@/lib/integracoes/vortx/relatorios-rotina.server',()=>({rotinaRelatoriosPermitida:enabled,executarRotinaRelatoriosVortx:run}))
import { GET } from './route'
beforeEach(()=>{vi.resetAllMocks();enabled.mockReturnValue(true);run.mockResolvedValue({estado:'EXECUTADA'});vi.stubEnv('CRON_SECRET','synthetic-daily-secret')})
afterEach(()=>vi.unstubAllEnvs())
describe('cron autenticado de relatórios',()=>{
  it('fora do escopo não revela endpoint nem executa',async()=>{
    enabled.mockReturnValue(false);expect((await GET(new Request('https://example.invalid/api/cron/vortx-relatorios'))).status).toBe(404);expect(run).not.toHaveBeenCalled()
  })
  it.each([undefined,'Bearer wrong','synthetic-daily-secret','bearer synthetic-daily-secret'])('nega credencial inválida %s',async token=>{
    const response=await GET(new Request('https://example.invalid/api/cron/vortx-relatorios',{headers:token?{authorization:token}:{}}))
    expect(response.status).toBe(401);expect(run).not.toHaveBeenCalled()
  })
  it('não aceita Fundo ou data por query',async()=>{
    expect((await GET(new Request('https://example.invalid/api/cron/vortx-relatorios?fundo=other',{headers:{authorization:'Bearer synthetic-daily-secret'}}))).status).toBe(400);expect(run).not.toHaveBeenCalled()
  })
  it('executa uma vez com segredo técnico, sem TOTP humano',async()=>{
    const response=await GET(new Request('https://example.invalid/api/cron/vortx-relatorios',{headers:{authorization:'Bearer synthetic-daily-secret'}}))
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(run).toHaveBeenCalledOnce()
  })
})
