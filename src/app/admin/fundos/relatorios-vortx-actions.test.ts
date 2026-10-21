import { beforeEach,describe,expect,it,vi } from 'vitest'
const {contexto,mfa,resolve,login,http,rpc}=vi.hoisted(()=>({contexto:vi.fn(),mfa:vi.fn(),resolve:vi.fn(),login:vi.fn(),http:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/integracoes/vortx/relatorios-contexto.server',()=>({carregarContextoRelatorios:contexto}))
vi.mock('@/lib/auth/sensitive-action',()=>({autorizarEConsumirAcaoSensivel:mfa}))
vi.mock('@/lib/integracoes/vortx/credenciais.server',()=>({resolverConfiguracaoVortxVrs:resolve}))
vi.mock('@/lib/integracoes/vortx/vortx-vrs-client.server',()=>({autenticarVortxVrs:login}))
vi.mock('@/lib/integracoes/vortx/relatorios-http.server',()=>({solicitarRelatorioVortxHttp:http}))
import { solicitarRelatorioVortx } from './relatorios-vortx-actions'
import { AuthorizationError } from '@/lib/auth/authorization'
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',version='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const input={fundoId:id,versaoId:version,tipo:'Inclusao',inicio:'2020-01-01',fim:'2020-01-02',referencia:'2020-01-02',extensao:2}
const pedido={codigoCarteira:'qa-carteira',tipoRelatorio:'Inclusao',dataInicio:input.inicio,dataFim:input.fim,dataReferencia:input.referencia,extensaoArquivo:2}
const credential={certificadoPem:'synthetic-cert-only',chavePrivadaPem:'synthetic-key-only'}
const row={id,fundo_id:id,integracao_versao_id:version,ambiente:'producao',pedido,estado:'registrada',protocolo_externo:null,codigo_http:null,criada_em:'2026-10-19T17:00:00Z',envio_iniciado_em:null,concluida_em:null}
const context={auth:{user:{id:'ator'},supabase:{rpc}},contexto:{fundo:{id,nome:'QA',cnpj:'00000000000000'},versoes:[{id:version,versao:1,ambiente:'producao',carteira:'qa-carteira',capabilities:['AQUISICOES']}]}}
beforeEach(()=>{
  vi.resetAllMocks();contexto.mockResolvedValue(context);mfa.mockResolvedValue({nonceHash:'a'.repeat(64)})
  resolve.mockResolvedValue({fundoId:id,ambiente:'producao',baseUrl:'https://api.vortx.com.br',credential})
  login.mockResolvedValue({accessToken:'qa-token'});http.mockResolvedValue({estado:'aceita',protocolo:id,http:200})
  rpc.mockImplementation(async(name,args)=>({data:name==='vortx_solicitar_relatorio'?{criada:true,solicitacao:row}:{...row,estado:args.p_estado,protocolo_externo:args.p_protocolo,codigo_http:args.p_http},error:null}))
})
describe('orquestração de relatório Vórtx',()=>{
  it('valida contexto sem TOTP adicional, reserva antes de login e registra início antes do único POST',async()=>{
    const result=await solicitarRelatorioVortx(input)
    expect(result).toMatchObject({success:true,criada:true,solicitacao:{estado:'aceita',protocolo_externo:id}})
    expect(mfa).not.toHaveBeenCalled()
    expect(rpc.mock.calls[0][0]).toBe('vortx_solicitar_relatorio')
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_nonce_hash')
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(resolve.mock.invocationCallOrder[0])
    expect(rpc.mock.invocationCallOrder[1]).toBeLessThan(http.mock.invocationCallOrder[0])
    expect(http).toHaveBeenCalledExactlyOnceWith({ambiente:'producao',token:'qa-token',pedido,credential})
    expect(JSON.stringify(result)).not.toMatch(/qa-token|123456|nonceHash|lease|synthetic-cert-only|synthetic-key-only/)
  })
  it('pedido idêntico não resolve segredo, faz login ou POST',async()=>{
    rpc.mockResolvedValue({data:{criada:false,solicitacao:row},error:null})
    expect(await solicitarRelatorioVortx(input)).toMatchObject({success:true,criada:false});expect(resolve).not.toHaveBeenCalled();expect(http).not.toHaveBeenCalled()
  })
  it('nova consulta explícita usa reserva com origem sem TOTP adicional antes de um único POST',async()=>{
    rpc.mockImplementation(async(name,args)=>({data:name==='vortx_solicitar_relatorio'
      ?{criada:true,solicitacao:{...row,revisao:2,solicitacao_anterior_id:version}}
      :{...row,estado:args.p_estado,protocolo_externo:args.p_protocolo,codigo_http:args.p_http},error:null}))
    expect(await solicitarRelatorioVortx({...input,solicitacaoAnteriorId:version})).toMatchObject({success:true,criada:true})
    expect(rpc.mock.calls[0]).toEqual(['vortx_solicitar_relatorio',expect.objectContaining({p_anterior:version})])
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_nonce_hash')
    expect(mfa).not.toHaveBeenCalled();expect(http).toHaveBeenCalledOnce()
  })
  it('retry da mesma origem recebe o sucessor existente sem novo login ou POST',async()=>{
    rpc.mockResolvedValue({data:{criada:false,solicitacao:{...row,revisao:2,solicitacao_anterior_id:version}},error:null})
    expect(await solicitarRelatorioVortx({...input,solicitacaoAnteriorId:version})).toMatchObject({success:true,criada:false})
    expect(login).not.toHaveBeenCalled();expect(http).not.toHaveBeenCalled()
  })
  it('origem divergente na reserva não recebe credenciais nem POST',async()=>{
    rpc.mockResolvedValue({data:{criada:true,solicitacao:{...row,solicitacao_anterior_id:id}},error:null})
    expect(await solicitarRelatorioVortx({...input,solicitacaoAnteriorId:version})).toMatchObject({success:false})
    expect(resolve).not.toHaveBeenCalled();expect(http).not.toHaveBeenCalled()
  })
  it('nova consulta não altera os campos históricos de transporte da posição',async()=>{
    const historical={...pedido,tipoRelatorio:'PosicaoAtivo',dataInicio:'2020-01-01',dataFim:'2020-01-07',dataReferencia:'2020-01-03'}
    contexto.mockResolvedValue({...context,contexto:{...context.contexto,versoes:[{...context.contexto.versoes[0],capabilities:['ESTOQUE']}]}})
    rpc.mockImplementation(async(name,args)=>({data:name==='vortx_solicitar_relatorio'?{criada:true,solicitacao:{...row,pedido:historical,solicitacao_anterior_id:version}}:{...row,pedido:historical,estado:args.p_estado,protocolo_externo:args.p_protocolo,codigo_http:args.p_http},error:null}))
    expect(await solicitarRelatorioVortx({...input,tipo:'PosicaoAtivo',inicio:'2020-01-01',fim:'2020-01-07',referencia:'2020-01-03',solicitacaoAnteriorId:version})).toMatchObject({success:true,criada:true})
    expect(http).toHaveBeenCalledWith(expect.objectContaining({pedido:historical}))
  })
  it.each(['URL','token','codigoCarteira','ambiente'])('rejeita %s do cliente antes de autenticar',async key=>{
    expect(await solicitarRelatorioVortx({...input,[key]:'arbitrario'})).toMatchObject({success:false});expect(contexto).not.toHaveBeenCalled()
  })
  it('falha de autorização do contexto não faz MFA nem lê segredo',async()=>{
    contexto.mockRejectedValue(new AuthorizationError('Sem vínculo','FORBIDDEN'))
    expect(await solicitarRelatorioVortx(input)).toEqual({success:false,message:'Sem vínculo'});expect(mfa).not.toHaveBeenCalled();expect(resolve).not.toHaveBeenCalled()
  })
  it('perfil somente leitura não reserva nem lê segredo, mesmo sem TOTP adicional',async()=>{
    contexto.mockResolvedValue({...context,contexto:{...context.contexto,podeSolicitar:false}})
    expect(await solicitarRelatorioVortx(input)).toMatchObject({success:false,message:expect.stringContaining('consultar')});expect(rpc).not.toHaveBeenCalled();expect(resolve).not.toHaveBeenCalled()
  })
  it.each([{versaoId:id},{tipo:'Exclusao'},{fim:'2999-01-01'},{fim:input.inicio}])('nega versão, capability ou data inválida (%#)',async change=>{
    expect(await solicitarRelatorioVortx({...input,...change})).toMatchObject({success:false});expect(mfa).not.toHaveBeenCalled();expect(resolve).not.toHaveBeenCalled()
  })
  it('erro na reserva bloqueia qualquer login ou POST',async()=>{
    rpc.mockResolvedValue({data:null,error:{code:'42501'}})
    expect(await solicitarRelatorioVortx(input)).toMatchObject({success:false});expect(resolve).not.toHaveBeenCalled();expect(http).not.toHaveBeenCalled()
  })
  it.each(['fundo_id','integracao_versao_id','ambiente'])('reserva divergente em %s bloqueia segredo',async key=>{
    rpc.mockResolvedValue({data:{criada:true,solicitacao:{...row,[key]:key==='ambiente'?'homologacao':'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}},error:null})
    expect(await solicitarRelatorioVortx(input)).toMatchObject({success:false});expect(resolve).not.toHaveBeenCalled()
  })
  it('carteira divergente na reserva bloqueia segredo',async()=>{
    rpc.mockResolvedValue({data:{criada:true,solicitacao:{...row,pedido:{...pedido,codigoCarteira:'outra'}}},error:null})
    expect(await solicitarRelatorioVortx(input)).toMatchObject({success:false});expect(resolve).not.toHaveBeenCalled()
  })
  it.each(['credencial','login'])('falha de %s marca não enviado sem relatório POST',async which=>{
    if(which==='credencial')resolve.mockRejectedValue(new Error('segredo-real'));else login.mockRejectedValue(new Error('segredo-real'))
    const result=await solicitarRelatorioVortx(input)
    expect(result).toMatchObject({success:true,solicitacao:{estado:'falha_autenticacao'}});expect(http).not.toHaveBeenCalled();expect(JSON.stringify(result)).not.toContain('segredo-real')
  })
  it('host de credencial fora do contrato não recebe login',async()=>{
    resolve.mockResolvedValue({fundoId:id,ambiente:'producao',baseUrl:'https://outro.test'})
    expect(await solicitarRelatorioVortx(input)).toMatchObject({success:true,solicitacao:{estado:'falha_autenticacao'}});expect(login).not.toHaveBeenCalled()
  })
  it('erro ao registrar enviando bloqueia POST',async()=>{
    rpc.mockImplementation(async name=>name==='vortx_solicitar_relatorio'?{data:{criada:true,solicitacao:row},error:null}:{data:null,error:{code:'42501'}})
    expect(await solicitarRelatorioVortx(input)).toMatchObject({success:false});expect(http).not.toHaveBeenCalled()
  })
  it('falha após POST conserva alerta de ambiguidade e não repete',async()=>{
    rpc.mockImplementation(async(name,args)=>name==='vortx_solicitar_relatorio'?{data:{criada:true,solicitacao:row},error:null}:args.p_estado==='enviando'?{data:{...row,estado:'enviando'},error:null}:{data:null,error:{code:'network'}})
    const result=await solicitarRelatorioVortx(input)
    expect(result).toMatchObject({success:false,message:expect.stringContaining('conclusão não foi confirmada')});expect(http).toHaveBeenCalledTimes(1);expect(login).toHaveBeenCalledTimes(1)
  })
})
