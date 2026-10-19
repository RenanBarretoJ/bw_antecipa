import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
const {admin,technical,binding,rpc}=vi.hoisted(()=>({admin:vi.fn(),technical:vi.fn(),binding:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/auth/admin-authorization',()=>({requireSuperAdmin:admin}))
vi.mock('@/lib/admin/configuracoes-tecnicas.server',()=>({obterConfiguracoesTecnicasAdminFundo:technical}))
import { carregarContextoRelatorios,carregarHistoricoRelatorios } from './relatorios-contexto.server'
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const version={id,versao:1,ambiente:'producao',status:'publicada',adapter_key:'vortx_vrs',configuracao_nao_sensivel:{codigo_carteira:'qa-carteira',private:'not-to-serialize'},active_capabilities:['ESTOQUE']}
const state={fundo:{id,nome:'QA',cnpj:'00000000000000',ativo:true},integracoes:[{status:'ativa',provider_key:'VORTX',versoes:[version]}],credenciais:[{segredo:'never-return'}]}
beforeEach(()=>{
  vi.resetAllMocks()
  for(const [key,value] of Object.entries({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/vortx-real-data-preview',NEXT_PUBLIC_SUPABASE_URL:'https://phdckowbexkkvuwnzeaf.supabase.co',VORTX_REPORTS_PREVIEW_ENABLED:'true',VORTX_REPORTS_PREVIEW_FUNDO_ID:id}))vi.stubEnv(key,value)
  const query={select:()=>query,eq:()=>query,maybeSingle:binding}
  admin.mockResolvedValue({user:{id:'ator'},supabase:{from:()=>query,rpc}})
  binding.mockResolvedValue({data:{id},error:null});technical.mockResolvedValue(state);rpc.mockResolvedValue({data:{total:0,solicitacoes:[]},error:null})
})
afterEach(()=>vi.unstubAllEnvs())
describe('contexto de relatórios somente Preview',()=>{
  it('serializa apenas contexto mínimo e capabilities ativas',async()=>{
    expect((await carregarContextoRelatorios(id)).contexto).toEqual({fundo:{id,nome:'QA',cnpj:'00000000000000'},versoes:[{id,versao:1,ambiente:'producao',carteira:'qa-carteira',capabilities:['ESTOQUE']}]})
  })
  it.each(['production','development'])('bloqueia %s antes da leitura',async environment=>{
    vi.stubEnv('VERCEL_ENV',environment);await expect(carregarContextoRelatorios(id)).rejects.toThrow('indisponível');expect(admin).not.toHaveBeenCalled()
  })
  it.each([{data:null,error:null},{data:{id},error:{code:'broken'}}])('vínculo ausente ou erro falha fechado (%#)',async result=>{
    binding.mockResolvedValue(result);await expect(carregarContextoRelatorios(id)).rejects.toThrow('vínculo ativo')
  })
  it('Fundo inativo não tem acesso',async()=>{
    technical.mockResolvedValue({...state,fundo:{...state.fundo,ativo:false}});await expect(carregarContextoRelatorios(id)).rejects.toThrow('vínculo ativo')
  })
  it.each([{status:'rascunho'},{adapter_key:'sinqia_soap'},{configuracao_nao_sensivel:{codigo_carteira:''}}])('não oferece versão sem contrato publicado válido (%#)',async change=>{
    technical.mockResolvedValue({...state,integracoes:[{...state.integracoes[0],versoes:[{...version,...change}]}]});expect((await carregarContextoRelatorios(id)).contexto.versoes).toEqual([])
  })
  it('histórico usa RPC paginada autenticada e não consulta provedor',async()=>{
    expect((await carregarHistoricoRelatorios(id,2)).historico).toEqual({total:0,solicitacoes:[]});expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_listar_relatorios_vortx',{p_fundo_id:id,p_pagina:2})
  })
  it('erro de histórico não se transforma em vazio ou sucesso',async()=>{
    rpc.mockResolvedValue({data:null,error:{code:'missing'}});await expect(carregarHistoricoRelatorios(id,1)).rejects.toThrow('Não foi possível carregar')
  })
})
