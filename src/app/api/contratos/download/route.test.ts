import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthorizationError } from '@/lib/auth/authorization'
import { GET } from './route'

const mocks=vi.hoisted(()=>({auth:vi.fn(),cedente:vi.fn(),operation:vi.fn(),view:vi.fn(),from:vi.fn(),signed:vi.fn(),name:vi.fn(),admin:vi.fn()}))
vi.mock('@/lib/auth/authorization',async original=>({...await original<typeof import('@/lib/auth/authorization')>(),
  requireAuthenticated:mocks.auth,requireCedenteAccess:mocks.cedente,requireOperationAccess:mocks.operation,requireOperationViewAccess:mocks.view}))
vi.mock('@/lib/supabase/server',()=>({createAdminClient:mocks.admin}))
vi.mock('@/lib/pdf/nome-download.server',()=>({resolverNomeDownloadDocumento:mocks.name}))
const id='90c3df7c-1111-4222-8333-444444444444',path='fundos/historico/documentos/original.pdf'
const request=(query=`tipo_entidade=operacao&entidade_id=${id}&tipo_documento=termo`)=>new NextRequest(`https://example.invalid/api/contratos/download?${query}`)
beforeEach(()=>{
  vi.resetAllMocks()
  const supabase={from:mocks.from},context={profile:{role:'gestor'},supabase}
  mocks.auth.mockResolvedValue(context);mocks.operation.mockResolvedValue(context);mocks.view.mockResolvedValue(context)
  mocks.cedente.mockResolvedValue({...context,cedente:{contrato_url:path}})
  const builder={select:vi.fn(()=>builder),eq:vi.fn(()=>builder),single:vi.fn(async()=>({data:{termo_url:path},error:null}))}
  mocks.from.mockReturnValue(builder)
  mocks.admin.mockReturnValue({storage:{from:()=>({createSignedUrl:mocks.signed})}})
  mocks.signed.mockResolvedValue({data:{signedUrl:'https://example.invalid/private-signed-download'},error:null})
  mocks.name.mockResolvedValue('TERMO_CESSAO_FIDC_HEALTH_90C3DF7C.PDF')
})
describe('download privado com nome canonico',()=>{
  it('usa apenas o path autorizado e nome do servidor, ignorando Fundo/nome/path enviados pelo cliente',async()=>{
    const response=await GET(request(`tipo_entidade=operacao&entidade_id=${id}&tipo_documento=termo&fundo=wrong&filename=evil&path=evil`))
    expect(response.status).toBe(200)
    expect(mocks.signed).toHaveBeenCalledExactlyOnceWith(path,3600,{download:'TERMO_CESSAO_FIDC_HEALTH_90C3DF7C.PDF'})
    expect(mocks.name.mock.calls[0][1]).toEqual({entidadeTipo:'operacao',entidadeId:id,tipo:'termo',storagePath:path})
    expect(mocks.operation.mock.invocationCallOrder[0]).toBeLessThan(mocks.admin.mock.invocationCallOrder[0])
  })
  it('mantem gate somente leitura para consultor',async()=>{
    mocks.auth.mockResolvedValue({profile:{role:'consultor'},supabase:{from:mocks.from}})
    expect((await GET(request())).status).toBe(200)
    expect(mocks.view).toHaveBeenCalled();expect(mocks.operation).not.toHaveBeenCalled()
  })
  it('nao assina nem resolve metadados sem autorizacao',async()=>{
    mocks.operation.mockRejectedValue(new AuthorizationError('Sem acesso.','FORBIDDEN'))
    expect((await GET(request())).status).toBe(403)
    expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.name).not.toHaveBeenCalled();expect(mocks.signed).not.toHaveBeenCalled()
  })
  it('preserva autorizacao do cedente e validade do link',async()=>{
    mocks.name.mockResolvedValue('CONTRATO_CESSAO_FIDC_HEALTH_14224864000100.PDF')
    expect((await GET(request('tipo_entidade=cedente&entidade_id=ced&tipo_documento=contrato'))).status).toBe(200)
    expect(mocks.cedente).toHaveBeenCalledWith('ced')
    expect(mocks.signed).toHaveBeenCalledWith(path,3600,{download:'CONTRATO_CESSAO_FIDC_HEALTH_14224864000100.PDF'})
  })
  it('mantem download legado quando nao existe contexto de nome inequivoco',async()=>{
    mocks.name.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(200)
    expect(mocks.signed).toHaveBeenCalledWith(path,3600,undefined)
  })
  it('recusa tipo incompativel antes de acessar Storage',async()=>{
    expect((await GET(request('tipo_entidade=cedente&entidade_id=ced&tipo_documento=termo'))).status).toBe(400)
    expect(mocks.signed).not.toHaveBeenCalled()
  })
})
