import { describe,expect,it } from 'vitest'
import { relatoriosPreviewPermitidos, situacaoRelatorio, solicitacaoRelatorioSchema, solicitarRelatorioSchema, RELATORIOS_OPERADOR, type SolicitacaoRelatorio } from './relatorios-operacao'
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'feature/vortx-real-data-preview',NEXT_PUBLIC_SUPABASE_URL:'https://phdckowbexkkvuwnzeaf.supabase.co',VORTX_REPORTS_PREVIEW_ENABLED:'true',VORTX_REPORTS_PREVIEW_FUNDO_ID:id}
export const row: SolicitacaoRelatorio = {id,fundo_id:id,integracao_versao_id:id,ambiente:'producao',pedido:{codigoCarteira:'qa',tipoRelatorio:'Inclusao',dataInicio:'2020-01-01',dataFim:'2020-01-02',dataReferencia:'2020-01-02',extensaoArquivo:2},estado:'aceita',protocolo_externo:id,codigo_http:200,criada_em:'2026-10-19T17:00:00Z',envio_iniciado_em:'2026-10-19T17:00:01Z',concluida_em:'2026-10-19T17:00:02Z'}
describe('apresentação e isolamento dos relatórios',()=>{
  it('permite somente a combinação exata da Preview autorizada',()=>expect(relatoriosPreviewPermitidos(id,env)).toBe(true))
  it.each(Object.keys(env))('nega alteração do guard %s',key=>expect(relatoriosPreviewPermitidos(id,{...env,[key]:'outro'})).toBe(false))
  it('nega outro Fundo',()=>expect(relatoriosPreviewPermitidos('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',env)).toBe(false))
  it('nunca chama protocolo de arquivo recebido/importado',()=>expect(situacaoRelatorio(row).titulo).toBe('Aguardando arquivo'))
  it.each(['registrada','enviando'] as const)('pedido %s antigo exige conferência sem retry',estado=>expect(situacaoRelatorio({...row,estado},Date.parse(row.criada_em)+120001)).toMatchObject({titulo:'Requer conferência',tom:'atencao'}))
  it.each(['recusada','indeterminada','falha_autenticacao'] as const)('estado %s tem orientação própria',estado=>expect(situacaoRelatorio({...row,estado}).descricao.length).toBeGreaterThan(40))
  it('DTO remove lease, sessão, hash e ator antes do navegador',()=>{
    const parsed=solicitacaoRelatorioSchema.parse({...row,lease_hash:'privado',session_id:id,hash_pedido:'privado',solicitada_por:id})
    expect(Object.keys(parsed)).not.toEqual(expect.arrayContaining(['lease_hash','session_id','hash_pedido','solicitada_por']))
    expect(JSON.stringify(parsed)).not.toContain('privado')
  })
  it('quatro tipos têm capabilities explícitas sem envio de remessa',()=>expect(RELATORIOS_OPERADOR.map(r=>r.capability)).toEqual(['ESTOQUE','ESTOQUE','AQUISICOES','LIQUIDACOES']))
  it.each(['endpoint','token','codigoCarteira','ambiente','userId'])('formulário rejeita campo arbitrário %s',key=>{
    expect(solicitarRelatorioSchema.safeParse({fundoId:id,versaoId:id,tipo:'Inclusao',inicio:'2020-01-01',fim:'2020-01-02',referencia:'2020-01-02',extensao:2,mfaCode:'123456',[key]:'outro'}).success).toBe(false)
  })
})
