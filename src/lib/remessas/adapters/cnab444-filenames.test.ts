import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gerarArquivoCnabLegado } from './cnab444.server'

const mocks=vi.hoisted(()=>({context:vi.fn(),generate:vi.fn(),from:vi.fn(),rpc:vi.fn(),upload:vi.fn(),download:vi.fn(),insert:vi.fn(),update:vi.fn()}))
vi.mock('node:crypto',async original=>({...await original<typeof import('node:crypto')>(),randomUUID:()=> '4378ab32-1111-4222-8333-444444444444'}))
vi.mock('@/lib/cnab/gerarCnab444',()=>({carregarContextoCnab444:mocks.context,gerarRemessaCnab444ComSequencial:mocks.generate}))
vi.mock('@/lib/supabase/server',()=>({createAdminClient:()=>({from:mocks.from,rpc:mocks.rpc,storage:{from:()=>({upload:mocks.upload,download:mocks.download})}})}))
vi.mock('@/lib/actions/auditoria',()=>({registrarLog:vi.fn()}))
let existing:object|null
beforeEach(()=>{
  vi.resetAllMocks();existing=null
  mocks.context.mockResolvedValue({fundo:{nome:'HEALTH I FUNDO DE INVESTIMENTO',id:'fund'},dataGeracao:'2026-10-16T10:00:00Z',idempotencyKey:'same-key',payloadHash:'same-hash',configuracao:{configuracaoId:'config'}})
  mocks.generate.mockImplementation((context,sequencial,nomeArquivo)=>({nomeArquivo,fundoId:'fund',configuracaoCnabId:'config',configuracaoCnabVersaoId:'version',idempotencyKey:'same-key',payloadHash:'same-hash',
    input:{configuracao:{versao:1,hash:'config-hash'}},resultado:{conteudo:'CNAB original\r\n',sha256:'bytes-hash',quantidadeRegistros:3,quantidadeTitulos:1,valorTotal:100},context,sequencial}))
  mocks.insert.mockResolvedValue({error:null});mocks.upload.mockResolvedValue({error:null})
  mocks.rpc.mockResolvedValue({data:2,error:null});mocks.download.mockResolvedValue({data:new Blob(['CNAB original\r\n']),error:null})
  mocks.from.mockImplementation(()=>{
    const builder={select:()=>builder,eq:()=>builder,maybeSingle:async()=>({data:existing,error:null}),insert:mocks.insert,
      update:(...args:unknown[])=>{mocks.update(...args);return {eq:async()=>({error:null})}}}
    return builder
  })
})
describe('nome curto do adapter CNAB Fromtis/Sinqia',()=>{
  it('persiste e entrega o mesmo nome curto, sem mudar sequencial nem conteudo',async()=>{
    const result=await gerarArquivoCnabLegado({operacaoId:'op',userId:'gestor'})
    expect(result.nomeArquivo).toBe('REM_HEALTH_4378AB32_20261016.REM')
    expect(result.storagePath).toMatch(/\/4378ab32-1111-4222-8333-444444444444\/REM_HEALTH_4378AB32_20261016.REM$/)
    expect(result.conteudo.toString()).toBe('CNAB original\r\n')
    expect(mocks.generate.mock.calls[0][1]).toBe(2)
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({nome_arquivo:result.nomeArquivo,sequencial:2,idempotency_key:'same-key',payload_hash:'same-hash'})
  })
  it('replay conserva nome/path historicos e nao cria ou regrava arquivo',async()=>{
    existing={id:'old',fundo_id:'fund',payload_hash:'same-hash',storage_path:'historical/path.REM',nome_arquivo:'REM_LONGO_ORIGINAL.REM',sha256:'bytes-hash'}
    const result=await gerarArquivoCnabLegado({operacaoId:'op',userId:'gestor'})
    expect(result).toMatchObject({nomeArquivo:'REM_LONGO_ORIGINAL.REM',storagePath:'historical/path.REM',idempotentReplay:true})
    expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.insert).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('mantem bloqueio de payload diferente na mesma chave',async()=>{
    existing={payload_hash:'different'}
    await expect(gerarArquivoCnabLegado({operacaoId:'op',userId:'gestor'})).rejects.toThrow(/payload diferente/)
    expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
