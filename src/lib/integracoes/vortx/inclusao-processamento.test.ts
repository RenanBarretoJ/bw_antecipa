import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { criptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'
import { interpretarCallbackRelatorio, prepararEventoCallback } from './relatorios-callback'
import { CONTEXTO_CSV_QA as ctx, csvVortxQa } from './__fixtures__/relatorios-csv'
const mocks=vi.hoisted(()=>({rpc:vi.fn(),download:vi.fn(),upload:vi.fn(),remove:vi.fn(),confirmed:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createAdminClient:()=>({rpc:mocks.rpc,storage:{from:()=>({upload:mocks.upload,remove:mocks.remove})},
  from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:mocks.confirmed})})})})})}))
vi.mock('./relatorios-download.server',async original=>({...await original<object>(),baixarRelatorioVortx:mocks.download}))
import { processarProximaInclusaoVortx } from './inclusao-processamento.server'
import { DownloadRelatorioError } from './relatorios-download.server'
const id=ctx.fundoId
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/vortx-real-data-preview',NEXT_PUBLIC_SUPABASE_URL:'https://phdckowbexkkvuwnzeaf.supabase.co',
  VORTX_REPORTS_PREVIEW_ENABLED:'true',VORTX_REPORTS_PREVIEW_FUNDO_ID:id,VORTX_REPORT_INCLUSION_PROCESSING_ENABLED:'true',VORTX_REPORT_DOWNLOAD_HOSTS:'reports.example.invalid'}
function job(){
  const evento=interpretarCallbackRelatorio({idRelatorio:id,idCarteira:ctx.codigoCarteira,tipoRelatorio:'Inclusao',dataReferencia:ctx.dataReferencia,
    dataInicio:ctx.dataInicio,dataFim:ctx.dataFim,statusRelatorio:'Disponível',urlRelatorio:'https://reports.example.invalid/report?sig=synthetic',dataExpiracao:new Date(Date.now()+86400000).toISOString()})
  const {hash}=prepararEventoCallback(id,evento)
  const sealed=criptografarPortalFidcValor(JSON.stringify({purpose:'VORTX_CALLBACK_RELATORIO_V1',endpointId:id,fundoId:id,ambiente:ctx.ambiente,codigoCarteira:ctx.codigoCarteira,hash,evento}))
  return {id,lease:id,fundo_id:id,versao_id:id,evento_id:id,ambiente:ctx.ambiente,codigo_carteira:ctx.codigoCarteira,data_referencia:ctx.dataReferencia,data_inicio:ctx.dataInicio,data_fim:ctx.dataFim,
    evento:{id,endpoint_id:id,fundo_id:id,ambiente:ctx.ambiente,hash_evento:hash,payload_criptografado:sealed.ciphertext,chave_versao:sealed.chaveVersao,correlacao:'CORRELACIONADO'}}
}
let manifestoId:string
beforeEach(()=>{
  vi.resetAllMocks();vi.stubEnv('PORTAL_FIDC_CREDENTIAL_KEYS_JSON',JSON.stringify({qa:Buffer.alloc(32,7).toString('base64')}));vi.stubEnv('PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION','qa')
  mocks.download.mockResolvedValue(csvVortxQa('Inclusao'));mocks.upload.mockResolvedValue({error:null});mocks.remove.mockResolvedValue({error:null});mocks.confirmed.mockResolvedValue({data:null,error:null})
  mocks.rpc.mockImplementation(async(name,args)=>{
    if(name==='vortx_reservar_processamento_inclusao')return {data:job(),error:null}
    if(name==='vortx_manifesto_inclusao'){manifestoId=args.p_manifesto.id;return {data:true,error:null}}
    if(name==='vortx_estagiar_inclusao')return {data:args.p_linhas.length,error:null}
    if(name==='vortx_concluir_inclusao')return {data:{id:manifestoId,estado:'PERSISTIDO',duplicada:false,inclusoes:1,conflitos:0},error:null}
    return {data:true,error:null}
  })
})
afterEach(()=>vi.unstubAllEnvs())
describe('durable Inclusion worker',()=>{
  it.each([{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{VORTX_REPORT_INCLUSION_PROCESSING_ENABLED:'false'},{VORTX_REPORT_DOWNLOAD_HOSTS:''}])('is inert outside Preview/flag %j',async change=>{
    expect(await processarProximaInclusaoVortx({...env,...change})).toEqual({estado:'DESABILITADO'});expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('does not download an unreserved report',async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:null});expect(await processarProximaInclusaoVortx(env)).toEqual({estado:'AGUARDANDO_RELATORIO'});expect(mocks.download).not.toHaveBeenCalled()
  })
  it('validates encrypted scope, records intent before upload, stages bounded data and completes without publishing',async()=>{
    expect(await processarProximaInclusaoVortx(env)).toMatchObject({estado:'PERSISTIDO',inclusoes:1,publicado:false})
    expect(mocks.rpc.mock.calls.map(c=>c[0])).toEqual(['vortx_reservar_processamento_inclusao','vortx_manifesto_inclusao','vortx_estagiar_inclusao','vortx_concluir_inclusao'])
    expect(mocks.rpc.mock.invocationCallOrder[1]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0])
    expect(mocks.upload.mock.calls[0][2]).toEqual({contentType:'text/csv',upsert:false});expect(mocks.remove).not.toHaveBeenCalled()
  })
  it.each(['data_inicio','data_fim','data_referencia','codigo_carteira'])('rejects altered %s before network',async key=>{
    const j={...job(),[key]:'other'};mocks.rpc.mockImplementation(async name=>({data:name==='vortx_reservar_processamento_inclusao'?j:true,error:null}))
    // Malformed lease response dates fail schema parsing; valid but wrong wallet fails the encrypted binding.
    if(key==='codigo_carteira')expect(await processarProximaInclusaoVortx(env)).toMatchObject({estado:'FALHA',motivo:'CONTRATO_INVALIDO'})
    else await expect(processarProximaInclusaoVortx(env)).rejects.toThrow()
    expect(mocks.download).not.toHaveBeenCalled();expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('preserves a download denial without exposing signed URL',async()=>{
    mocks.download.mockRejectedValue(new DownloadRelatorioError('HOST_NEGADO'))
    expect(await processarProximaInclusaoVortx(env)).toEqual({estado:'FALHA',motivo:'DOWNLOAD_FALHOU'});expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('does not upload or persist an invalid CSV',async()=>{
    mocks.download.mockResolvedValue(Buffer.from('invalid'))
    expect(await processarProximaInclusaoVortx(env)).toEqual({estado:'FALHA',motivo:'CONTRATO_INVALIDO'});expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('denied intent cannot upload',async()=>{
    const impl=mocks.rpc.getMockImplementation()!;mocks.rpc.mockImplementation(async(name,args)=>name==='vortx_manifesto_inclusao'?{data:false,error:null}:impl(name,args))
    expect(await processarProximaInclusaoVortx(env)).toMatchObject({estado:'FALHA'});expect(mocks.upload).not.toHaveBeenCalled()
  })
  it('staging failure compensates only this attempt before any financial commit',async()=>{
    const impl=mocks.rpc.getMockImplementation()!;mocks.rpc.mockImplementation(async(name,args)=>name==='vortx_estagiar_inclusao'?{data:null,error:{code:'qa'}}:impl(name,args))
    expect(await processarProximaInclusaoVortx(env)).toMatchObject({estado:'FALHA'})
    expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]])
    expect(mocks.rpc.mock.calls.some(c=>c[0]==='vortx_concluir_inclusao')).toBe(false)
  })
  it.each(['absent','possibly_committed','lookup_failed'])('unknown completion preserves potentially committed original: %s',async mode=>{
    const impl=mocks.rpc.getMockImplementation()!;mocks.rpc.mockImplementation(async(name,args)=>name==='vortx_concluir_inclusao'?{data:null,error:{code:'transport'}}:impl(name,args))
    mocks.confirmed.mockResolvedValue(mode==='lookup_failed'?{data:null,error:{code:'qa'}}:{data:mode==='possibly_committed'?{id}:null,error:null})
    expect(await processarProximaInclusaoVortx(env)).toMatchObject({estado:'FALHA'})
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('duplicate completion discards only this retry upload',async()=>{
    const impl=mocks.rpc.getMockImplementation()!;mocks.rpc.mockImplementation(async(name,args)=>name==='vortx_concluir_inclusao'?{data:{id,estado:'PERSISTIDO',duplicada:true,inclusoes:1,conflitos:0},error:null}:impl(name,args))
    expect(await processarProximaInclusaoVortx(env)).toMatchObject({duplicada:true});expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]])
  })
  it('does not turn an unconfirmed cleanup into a false success',async()=>{
    const impl=mocks.rpc.getMockImplementation()!;mocks.rpc.mockImplementation(async(name,args)=>name==='vortx_concluir_inclusao'?{data:{id,estado:'PERSISTIDO',duplicada:true,inclusoes:1,conflitos:0},error:null}:name==='vortx_falhar_inclusao'?{data:false,error:null}:impl(name,args))
    mocks.remove.mockResolvedValue({error:{code:'qa'}});await expect(processarProximaInclusaoVortx(env)).rejects.toThrow('INDETERMINADO')
  })
})
