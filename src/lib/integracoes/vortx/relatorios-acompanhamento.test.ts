import { describe,expect,it } from 'vitest'
import { acompanharRelatorio } from './relatorios-acompanhamento'
import type { SolicitacaoRelatorio } from './relatorios-operacao'
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const row:SolicitacaoRelatorio={id,fundo_id:id,integracao_versao_id:id,ambiente:'producao',pedido:{codigoCarteira:'qa',tipoRelatorio:'PosicaoAtivo',dataInicio:'2020-01-01',dataFim:'2020-01-02',dataReferencia:'2020-01-02',extensaoArquivo:2},estado:'aceita',protocolo_externo:id,codigo_http:200,criada_em:'2026-10-19T17:00:00Z',envio_iniciado_em:null,concluida_em:null}
const empty:NonNullable<SolicitacaoRelatorio['acompanhamento']>={recebidoEm:null,arquivoStatus:null,processamento:null,downloadEm:null,processadoEm:null,erro:null,publicacao:null,publicadoEm:null,ativos:0,parcelas:0,duplicada:false}
describe('etapas operacionais baseadas em fatos persistidos',()=>{
  it('protocolo não é recebimento nem importação',()=>expect(acompanharRelatorio(row).titulo).toBe('Pedido aceito pela Vórtx'))
  it('posição disponível aguarda par, sem afirmar download',()=>expect(acompanharRelatorio({...row,acompanhamento:{...empty,arquivoStatus:'Disponível'}}).titulo).toContain('aguardando par'))
  it('inclusão não implica aquisição automática',()=>expect(acompanharRelatorio({...row,pedido:{...row.pedido,tipoRelatorio:'Inclusao'},acompanhamento:{...empty,arquivoStatus:'Disponível'}}).descricao).toContain('nenhuma aquisição ou baixa'))
  it.each([['PROCESSANDO',null,'Baixando arquivos'],['PROCESSANDO','2026-10-20T12:00:00Z','Validando e salvando'],['REVISAO',null,'Importado · em revisão'],['PERSISTIDO',null,'Importado'],['FALHA',null,'Processamento requer atenção']] as const)('distingue %s e download %s', (state,download,title)=>{
    expect(acompanharRelatorio({...row,acompanhamento:{...empty,processamento:state,downloadEm:download}}).titulo).toBe(title)
  })
  it('reconhece deduplicação sem afirmar nova persistência',()=>expect(acompanharRelatorio({...row,acompanhamento:{...empty,processamento:'PERSISTIDO',duplicada:true}}).titulo).toBe('Conteúdo já importado'))
  it('importação em revisão nunca é publicação',()=>expect(acompanharRelatorio({...row,acompanhamento:{...empty,processamento:'REVISAO'}}).descricao).toContain('não foi publicado'))
  it('PDD advisory reports real persistence but never financial publication',()=>{
    const result=acompanharRelatorio({...row,acompanhamento:{...empty,processamento:'PERSISTIDO',pddPendente:true}})
    expect(result.titulo).toBe('Importado · PDD a conferir')
    expect(result.descricao).toContain('sem bloquear a persistência')
    expect(result.descricao).toContain('não foi publicado')
    expect(result.tom).toBe('atencao')
  })
  it('PDD warning cannot hide another financial discrepancy',()=>{
    expect(acompanharRelatorio({...row,acompanhamento:{...empty,processamento:'REVISAO',pddPendente:true}}).titulo).toBe('Importado · em revisão')
  })
  it('publicação comprovada prevalece sobre expiração posterior do link',()=>expect(acompanharRelatorio({...row,acompanhamento:{...empty,arquivoStatus:'Expirado',publicacao:'PUBLICADA'}}).titulo).toBe('Publicado nos módulos'))
})
