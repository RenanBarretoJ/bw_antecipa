import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/server'
import { resolverNomeDownloadDocumento } from './nome-download.server'

const mocks=vi.hoisted(()=>({from:vi.fn()}))
vi.mock('@/lib/supabase/server',()=>({createAdminClient:()=>({from:mocks.from})}))
const input={entidadeTipo:'operacao' as const,entidadeId:'90c3df7c-1111-4222-8333-444444444444',tipo:'termo' as const,storagePath:'original/version.pdf'}
let rows:Record<string,unknown>,filters:Record<string,unknown[][]>
beforeEach(()=>{
  vi.resetAllMocks()
  rows={operacoes:{cedente_fundo_id:'historical-link'},cedente_fundos:{fundo_id:'historical-fund'},fundos:{nome:'HEALTH I FIDC'}}
  filters={}
  mocks.from.mockImplementation((table:string)=>{
    const builder={select:vi.fn(()=>builder),eq:vi.fn((...args:unknown[])=>{(filters[table]??=[]).push(args);return builder}),
      maybeSingle:vi.fn(async()=>({data:rows[table]??null,error:null})),limit:vi.fn(async()=>({data:rows[table]??[],error:null}))}
    return builder
  })
})
describe('contexto canonico do nome de download',()=>{
  it('usa o Fundo historico da operacao, sem cookie ou vinculo atual do cedente',async()=>{
    expect(await resolverNomeDownloadDocumento(createAdminClient(),input)).toBe('TERMO_CESSAO_FIDC_HEALTH_90C3DF7C.PDF')
    expect(filters.cedente_fundos).toEqual([['id','historical-link']]);expect(filters.fundos).toEqual([['id','historical-fund']])
  })
  it('contrato usa CNPJ completo e Fundo do documento registrado',async()=>{
    rows.cedentes={cnpj:'14.224.864/0001-00'};rows.documentos_gerados={fundo_id:'document-fund'}
    expect(await resolverNomeDownloadDocumento(createAdminClient(),{...input,entidadeTipo:'cedente',entidadeId:'ced',tipo:'contrato'})).toBe('CONTRATO_CESSAO_FIDC_HEALTH_14224864000100.PDF')
    expect(filters.documentos_gerados).toEqual([['cedente_id','ced'],['storage_path',input.storagePath]])
    expect(filters.fundos).toEqual([['id','document-fund']])
  })
  it('contrato legado exige vinculo unico, sem escolher arbitrariamente entre Fundos',async()=>{
    rows.cedentes={cnpj:'14224864000100'};rows.cedente_fundos=[{fundo_id:'one'},{fundo_id:'two'}]
    expect(await resolverNomeDownloadDocumento(createAdminClient(),{...input,entidadeTipo:'cedente',tipo:'contrato'})).toBeNull()
    expect(mocks.from.mock.calls.map(c=>c[0])).not.toContain('fundos')
    rows.cedente_fundos=[{fundo_id:'only'}]
    expect(await resolverNomeDownloadDocumento(createAdminClient(),{...input,entidadeTipo:'cedente',tipo:'contrato'})).toBe('CONTRATO_CESSAO_FIDC_HEALTH_14224864000100.PDF')
  })
  it('nao inventa Fundo ausente nem muda download de remessa/comprovante',async()=>{
    rows.operacoes={cedente_fundo_id:null}
    expect(await resolverNomeDownloadDocumento(createAdminClient(),input)).toBeNull()
    mocks.from.mockClear()
    expect(await resolverNomeDownloadDocumento(createAdminClient(),{...input,tipo:'remessa'})).toBeNull()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
