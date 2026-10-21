import { beforeEach, describe, expect, it, vi } from 'vitest'
const { rpc, send, admin } = vi.hoisted(() => ({ rpc:vi.fn(), send:vi.fn(), admin:vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient:admin }))
vi.mock('./relatorios-envio.server', () => ({ enviarRelatorioReservado:send }))
import { executarRotinaRelatoriosVortx } from './relatorios-rotina.server'
const fund='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',version='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const env={ VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/vortx-real-data-preview',NEXT_PUBLIC_SUPABASE_URL:'https://phdckowbexkkvuwnzeaf.supabase.co',VORTX_REPORTS_PREVIEW_ENABLED:'true',VORTX_REPORTS_PREVIEW_FUNDO_ID:fund,VORTX_REPORTS_DAILY_ENABLED:'true' }
const context={fundo:{id:fund,nome:'Synthetic',cnpj:'00000000000000'},podeSolicitar:true,versoes:[{id:version,versao:1,ambiente:'producao',carteira:'synthetic-wallet',capabilities:['ESTOQUE','AQUISICOES','LIQUIDACOES']}]}
const clock=new Date('2026-10-20T12:30:00Z')
function row(args:Record<string,unknown>) {
  return { id:version,fundo_id:fund,integracao_versao_id:version,ambiente:'producao',origem:'CRON',
    pedido:{ codigoCarteira:'synthetic-wallet',tipoRelatorio:args.p_tipo??'Inclusao',dataInicio:args.p_inicio??'2026-10-18',dataFim:args.p_fim??'2026-10-19',dataReferencia:args.p_referencia??'2026-10-19',extensaoArquivo:2 },
    estado:'registrada',protocolo_externo:null,codigo_http:null,criada_em:clock.toISOString(),envio_iniciado_em:null,concluida_em:null }
}
beforeEach(() => {
  vi.resetAllMocks();admin.mockReturnValue({rpc})
  rpc.mockImplementation(async (name,args) => ({data:name==='vortx_contexto_rotina'?context:name==='vortx_rotina_reservar'?{criada:true,solicitacao:row(args)}:{...row({}),estado:args.p_estado},error:null}))
  send.mockImplementation(async (r,transition) => {await transition('enviando');return {...r,estado:'aceita'} })
})
describe('rotina técnica sem sessão humana nem TOTP', () => {
  it.each([{VERCEL_ENV:'production'},{VORTX_REPORTS_DAILY_ENABLED:'false'},{VERCEL_GIT_COMMIT_REF:'main'},{NEXT_PUBLIC_SUPABASE_URL:'https://other.supabase.co'}])('fica inerte fora da autorização %j',async change => {
    expect(await executarRotinaRelatoriosVortx({...env,...change},clock)).toEqual({estado:'DESABILITADA'});expect(admin).not.toHaveBeenCalled()
  })
  it('ignora feriado antes de acessar o banco ou o provedor',async()=>{
    expect(await executarRotinaRelatoriosVortx(env,new Date('2026-10-12T12:30:00Z'))).toMatchObject({estado:'IGNORADA'});expect(admin).not.toHaveBeenCalled()
  })
  it('solicita exatamente quatro relatórios, com contexto validado e transição técnica',async()=>{
    expect(await executarRotinaRelatoriosVortx(env,clock)).toMatchObject({estado:'EXECUTADA',referencia:'2026-10-19',resultados:expect.arrayContaining([{tipo:'Inclusao',estado:'aceita',nova:true}])})
    expect(send).toHaveBeenCalledTimes(4)
    const reservations=rpc.mock.calls.filter(([name])=>name==='vortx_rotina_reservar')
    expect(reservations).toHaveLength(4)
    for(const [,args] of reservations) {expect(args).toMatchObject({p_fundo_id:fund,p_versao_id:version,p_referencia:'2026-10-19'});expect(args).not.toHaveProperty('p_nonce_hash');expect(args.p_lease_hash).toMatch(/^[0-9a-f]{64}$/)}
    expect(rpc.mock.calls.filter(([name])=>name==='vortx_rotina_transicionar')).toHaveLength(4)
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/publicar|finalizar|session_id|mfaCode/)
  })
  it('reexecução idempotente não consulta novamente o provedor',async()=>{
    rpc.mockImplementation(async(name,args)=>({data:name==='vortx_contexto_rotina'?context:{criada:false,solicitacao:row(args)},error:null}))
    const result=await executarRotinaRelatoriosVortx(env,clock)
    expect(result).toMatchObject({estado:'EXECUTADA'});expect(send).not.toHaveBeenCalled()
  })
  it.each(['fundo','origem','pedido'])('não envia quando a reserva diverge em %s',async kind=>{
    rpc.mockImplementation(async(name,args)=>({data:name==='vortx_contexto_rotina'?context:{criada:true,solicitacao:{...row(args),...(kind==='fundo'?{fundo_id:version}:kind==='origem'?{origem:'MANUAL'}:{pedido:{...row(args).pedido,codigoCarteira:'wrong'}})}},error:null}))
    expect(await executarRotinaRelatoriosVortx(env,clock)).toMatchObject({resultados:Array(4).fill({tipo:expect.any(String),estado:'REQUER_CONFERENCIA'})});expect(send).not.toHaveBeenCalled()
  })
  it('ambiguidade de versão falha fechado sem selecionar a primeira',async()=>{
    rpc.mockResolvedValue({data:{...context,versoes:[...context.versoes,...context.versoes]},error:null})
    expect(await executarRotinaRelatoriosVortx(env,clock)).toMatchObject({resultados:Array(4).fill({tipo:expect.any(String),estado:'FONTE_INDISPONIVEL'})});expect(send).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledOnce()
  })
  it('erro de uma consulta não gera retry nem impede os demais tipos',async()=>{
    send.mockRejectedValueOnce(new Error('synthetic-private')).mockImplementation(async r=>({...r,estado:'aceita'}))
    const result=await executarRotinaRelatoriosVortx(env,clock)
    expect(send).toHaveBeenCalledTimes(4);expect(JSON.stringify(result)).not.toContain('synthetic-private')
    expect(result).toMatchObject({resultados:expect.arrayContaining([{tipo:'PosicaoParcela',estado:'REQUER_CONFERENCIA'},{tipo:'Exclusao',estado:'aceita',nova:true}])})
  })
})
