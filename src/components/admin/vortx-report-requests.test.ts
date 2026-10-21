import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SolicitacaoRelatorio } from '@/lib/integracoes/vortx/relatorios-operacao'
import { VortxReportRequests } from './vortx-report-requests'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/admin/fundos/relatorios-vortx-actions', () => ({ solicitarRelatorioVortx: vi.fn() }))
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const row: SolicitacaoRelatorio = { id, fundo_id: id, integracao_versao_id: id, ambiente: 'producao',
  pedido: { codigoCarteira: 'qa', tipoRelatorio: 'Inclusao', dataInicio: '2020-01-01', dataFim: '2020-01-02', dataReferencia: '2020-01-02', extensaoArquivo: 2 },
  estado: 'aceita', protocolo_externo: id, codigo_http: 200, criada_em: '2026-10-19T17:00:00Z', envio_iniciado_em: null, concluida_em: null }
const contexto = { fundo: { id: row.fundo_id, nome: 'Fundo QA', cnpj: '00000000000000' },
  versoes: [{ id: row.integracao_versao_id, versao: 1, ambiente: 'producao' as const, carteira: 'qa', capabilities: ['ESTOQUE', 'AQUISICOES'] }] }

describe('histórico de relatórios com solicitação explícita', () => {
  it('implementa a opção 1 somente no conteúdo, sem inventar carteira ou habilitar upload incompatível', () => {
    const html = renderToStaticMarkup(createElement(VortxReportRequests, { contexto, historico: { total: 0, solicitacoes: [], resumo: [] }, pagina: 1, hoje: '2026-10-20' }))
    expect(html).toContain('Central de Bases')
    expect(html).toContain('Filtrar histórico completo')
    expect(html).toContain('Importação manual')
    expect(html).toContain('ainda não está conectado nesta tela')
    expect(html).not.toContain('type="file"')
    expect(html).not.toMatch(/<aside|<header|service_role|token=/)
  })
  it('resumo permanece independente da página filtrada e não trata HTTP 200 como importação', () => {
    const html = renderToStaticMarkup(createElement(VortxReportRequests, { contexto, historico: { total: 0, solicitacoes: [], resumo: [row] }, filtros: { tipo: 'Exclusao' }, pagina: 1, hoje: '2026-10-20' }))
    expect(html).toContain('Pedido aceito pela Vórtx')
    expect(html).toContain('02/01/2020')
    expect(html).toContain('Nenhum pedido corresponde aos filtros')
    expect(html).not.toContain('Publicado nos módulos')
  })
  it('paginação preserva filtros e a aba administrativa', () => {
    const html = renderToStaticMarkup(createElement(VortxReportRequests, { contexto, historico: { total: 25, solicitacoes: [row] }, filtros: { tipo: 'Inclusao' }, historicoHref: '/admin/fundos/qa?tab=dados-financeiros', pagina: 1, hoje: '2026-10-20' }))
    expect(html).toContain('tab=dados-financeiros&amp;tipo=Inclusao&amp;pagina=2#historico-bases')
  })
  it('não renderiza TOTP adicional nem leva Gestor à configuração administrativa',()=>{
    const html=renderToStaticMarkup(createElement(VortxReportRequests,{contexto:{...contexto,versoes:[]},historico:{total:0,solicitacoes:[]},pagina:1,hoje:'2026-10-20'}))
    expect(html).not.toMatch(/mfaCode|autocomplete="one-time-code"|\/admin\/fundos/)
    expect(html).toContain('Peça ao administrador')
  })
  it('LEITOR acompanha mas não pode iniciar revisão ou nova solicitação',()=>{
    const html=renderToStaticMarkup(createElement(VortxReportRequests,{contexto:{...contexto,podeSolicitar:false},historico:{total:1,solicitacoes:[row]},pagina:1,hoje:'2026-10-20'}))
    expect(html.match(/<button[^>]*aria-label="Solicitar novamente[^>]+>/)?.[0]).toContain('disabled')
    expect(html).toContain('sem iniciar novas solicitações')
    expect(html).toContain('Não exige código TOTP adicional')
  })
  it('mostra ação identificável, origem e separa pedido de publicação', () => {
    const html = renderToStaticMarkup(createElement(VortxReportRequests, { contexto, historico: { total: 1,
      solicitacoes: [{ ...row, revisao: 2, solicitacao_anterior_id: row.id }] }, pagina: 1, hoje: '2026-10-20' }))
    expect(html).toContain('Solicitar novamente')
    expect(html).toContain('aria-label="Solicitar novamente Cessões realizadas de 02/01/2020"')
    expect(html).toContain('Solicitação manual')
    expect(html).toContain('nova consulta vinculada à anterior')
    expect(html).toContain('arquivos idênticos não duplicarão o estoque')
    expect(html).not.toContain('nenhum arquivo é baixado')
  })
  it.each(['registrada', 'enviando'] as const)('desabilita nova consulta com pedido %s', estado => {
    const html = renderToStaticMarkup(createElement(VortxReportRequests, { contexto, historico: { total: 1,
      solicitacoes: [{ ...row, estado }] }, pagina: 1, hoje: '2026-10-20' }))
    const button = html.match(/<button[^>]*aria-label="Solicitar novamente[^>]+>/)?.[0]
    expect(button).toContain('disabled')
  })
})
