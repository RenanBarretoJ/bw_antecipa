import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agruparAvisosNotas } from './lote'

vi.mock('server-only', () => ({}))
const m=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),email:vi.fn(),template:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createAdminClient:()=>({rpc:m.rpc,from:m.from})}))
vi.mock('@/lib/email',()=>({enviarEmail:m.email,emailTemplates:{operacaoLiquidada:m.template}}))
import { criarNotificacao, notificarCedente, notificarCedenteCadastro, notificarGestores } from '@/lib/actions/notificacao'

describe('internal scoped notification producers',()=>{
  beforeEach(()=>{
    vi.resetAllMocks()
    m.rpc.mockResolvedValue({data:[],error:null})
    const q={select:vi.fn(()=>q),eq:vi.fn(()=>q),single:vi.fn(async()=>({data:{email:'qa@example.invalid',nome_completo:'QA'}}))}
    m.from.mockReturnValue(q)
    m.template.mockReturnValue({subject:'QA',html:'QA'})
  })
  it.each(['nota_fiscal','operacao','cedente_fundo','entrega','evento_dominio'] as const)('derives %s recipients on the server, with no client fund',async(entidadeTipo)=>{
    const contexto={entidadeTipo,entidadeId:'entity'}
    expect(await notificarGestores(contexto,'QA','QA message','info','event')).toEqual({success:true,criadas:0})
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith('notificar_entidade',{
      p_entidade_tipo:entidadeTipo,p_entidade_id:'entity',p_destino:'gestor',p_titulo:'QA',p_mensagem:'QA message',
      p_tipo:'info',p_dedupe_key:'event',p_usuario_id:null,p_somente_admin:false,
    })
    expect(m.from).not.toHaveBeenCalled()
  })
  it('validates a targeted Sacado recipient through the same entity boundary',async()=>{
    await criarNotificacao({usuario_id:'sacado',contexto:{entidadeTipo:'operacao',entidadeId:'op'},destino:'sacado',titulo:'QA',mensagem:'QA',tipo:'cessao_credito',dedupe_key:'key'})
    expect(m.rpc).toHaveBeenCalledWith('notificar_entidade',expect.objectContaining({p_destino:'sacado',p_usuario_id:'sacado',p_entidade_id:'op'}))
    expect(m.email).not.toHaveBeenCalled()
  })
  it('sends email only to newly inserted recipients, not ignored duplicate rows',async()=>{
    m.rpc.mockResolvedValueOnce({data:[{usuario_id:'new-user',notificacao_id:'new'}],error:null})
    await notificarCedente({entidadeTipo:'operacao',entidadeId:'op'},'QA','Operacao #abc liquidada','operacao_liquidada','key')
    await notificarCedente({entidadeTipo:'operacao',entidadeId:'op'},'QA','Operacao #abc liquidada','operacao_liquidada','key')
    expect(m.email).toHaveBeenCalledTimes(1)
  })
  it('uses explicit shared routing only for registration and admin access filtering',async()=>{
    await notificarCedenteCadastro('cedente','QA','QA','documento_aprovado','doc:1','administrativo')
    expect(m.rpc).toHaveBeenCalledWith('notificar_cedente_cadastro',expect.objectContaining({p_cedente_id:'cedente',p_somente_admin:true}))
    expect(m.from).not.toHaveBeenCalled()
  })
  it('never falls back to another fund/global or sends email on a rejected insert',async()=>{
    const log=vi.spyOn(console,'error').mockImplementation(()=>{})
    m.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'sensitive SQL'}})
    expect(await notificarCedente({entidadeTipo:'operacao',entidadeId:'op'},'QA','QA','operacao_liquidada','key')).toEqual({success:false})
    expect(m.rpc).toHaveBeenCalledTimes(1);expect(m.from).not.toHaveBeenCalled();expect(m.email).not.toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive SQL')
    log.mockRestore()
  })
  it('separates the same cedente by fund/link and does not invent missing scope',()=>{
    const notes=[{id:'1',numero_nf:'NF1',cedente_id:'C',fundo_id:'A',cedente_fundo_id:'CA'},
      {id:'2',numero_nf:'NF2',cedente_id:'C',fundo_id:'B',cedente_fundo_id:'CB'},
      {id:'3',numero_nf:'NF3',cedente_id:'C',fundo_id:'A',cedente_fundo_id:'CA'},
      {id:'4',numero_nf:'NF4',cedente_id:'C',fundo_id:null,cedente_fundo_id:null}]
    const groups=agruparAvisosNotas(notes)
    expect(groups).toHaveLength(2)
    expect(groups.map(g=>[g.vinculoId,g.notas.map(n=>n.id)])).toEqual([['CA',['1','3']],['CB',['2']]])
  })
})
