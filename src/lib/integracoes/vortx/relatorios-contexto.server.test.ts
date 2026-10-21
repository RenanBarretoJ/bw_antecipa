import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
const {admin,rpc}=vi.hoisted(()=>({admin:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/auth/authorization',async original=>({...await original<object>(),requireAuthenticated:admin}))
import { carregarContextoRelatorios,carregarHistoricoRelatorios } from './relatorios-contexto.server'
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const version={id,versao:1,ambiente:'producao',carteira:'qa-carteira',capabilities:['ESTOQUE']}
const state={fundo:{id,nome:'QA',cnpj:'00000000000000'},podeSolicitar:true,versoes:[version]}
beforeEach(()=>{
  vi.resetAllMocks()
  for(const [key,value] of Object.entries({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/vortx-real-data-preview',NEXT_PUBLIC_SUPABASE_URL:'https://phdckowbexkkvuwnzeaf.supabase.co',VORTX_REPORTS_PREVIEW_ENABLED:'true',VORTX_REPORTS_PREVIEW_FUNDO_ID:id}))vi.stubEnv(key,value)
  admin.mockResolvedValue({user:{id:'ator'},supabase:{rpc}})
  rpc.mockImplementation(async name=>({data:name==='vortx_contexto_relatorios'?state:{total:0,solicitacoes:[]},error:null}))
})
afterEach(()=>vi.unstubAllEnvs())
describe('contexto de relatórios somente Preview',()=>{
  it('serializa apenas contexto mínimo e capabilities ativas',async()=>{
    rpc.mockResolvedValue({data:{...state,credenciais:[{segredo:'never-return'}],versoes:[{...version,private:'never-return'}]},error:null})
    expect((await carregarContextoRelatorios(id)).contexto).toEqual(state)
    expect(rpc).toHaveBeenCalledWith('vortx_contexto_relatorios',{p_fundo_id:id})
  })
  it.each(['production','development'])('bloqueia %s antes da leitura',async environment=>{
    vi.stubEnv('VERCEL_ENV',environment);await expect(carregarContextoRelatorios(id)).rejects.toThrow('indisponível');expect(admin).not.toHaveBeenCalled()
  })
  it.each([{data:null,error:null},{data:{id},error:{code:'broken'}}])('vínculo ausente ou erro falha fechado (%#)',async result=>{
    rpc.mockResolvedValue(result);await expect(carregarContextoRelatorios(id)).rejects.toThrow('vínculo ativo')
  })
  it('Fundo inativo não tem acesso',async()=>{
    rpc.mockResolvedValue({data:null,error:{code:'42501'}});await expect(carregarContextoRelatorios(id)).rejects.toThrow('vínculo ativo')
  })
  it('versões não publicadas, de outro provider ou sem carteira são omitidas pela RPC autorizada',async()=>{
    rpc.mockResolvedValue({data:{...state,versoes:[]},error:null});expect((await carregarContextoRelatorios(id)).contexto.versoes).toEqual([])
  })
  it('contexto de outro Fundo falha fechado',async()=>{
    rpc.mockResolvedValue({data:{...state,fundo:{...state.fundo,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}},error:null})
    await expect(carregarContextoRelatorios(id)).rejects.toThrow('vínculo ativo')
  })
  it('mantém leitura explícita para LEITOR',async()=>{
    rpc.mockResolvedValue({data:{...state,podeSolicitar:false},error:null});expect((await carregarContextoRelatorios(id)).contexto.podeSolicitar).toBe(false)
  })
  it('histórico usa RPC paginada autenticada e não consulta provedor',async()=>{
    expect((await carregarHistoricoRelatorios(id,2)).historico).toEqual({total:0,solicitacoes:[]});expect(rpc).toHaveBeenCalledWith('admin_listar_relatorios_vortx',{p_fundo_id:id,p_pagina:2});expect(rpc).toHaveBeenCalledTimes(2)
  })
  it('erro de histórico não se transforma em vazio ou sucesso',async()=>{
    rpc.mockResolvedValueOnce({data:state,error:null}).mockResolvedValueOnce({data:null,error:{code:'missing'}});await expect(carregarHistoricoRelatorios(id,1)).rejects.toThrow('Não foi possível carregar')
  })
})
