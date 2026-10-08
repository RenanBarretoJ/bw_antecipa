import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminConfiguracoesTecnicasFundo, AdminIntegracaoVersao } from '@/lib/admin/configuracoes-tecnicas'

const { resolver } = vi.hoisted(() => ({ resolver: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/integracoes/resolver.server', () => ({ resolverIntegracaoPorCapability: resolver, integrationRuntimeEnvironment: () => 'producao' }))
vi.mock('@/components/admin/fundo-cnab-tecnico', () => ({ FundoCnabTecnico: () => createElement('section', null, 'FORMULARIO CNAB') }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => createElement('a', { href }, children) }))
import { FundoEnviosOperacionais } from './fundo-envios-operacionais'

const base: AdminConfiguracoesTecnicasFundo = {
  fundo: { id: 'f1', nome: 'QA', cnpj: '98000000000168', ativo: true },
  integracoes: [], cnab: [], credenciais: [], execucoes: [], execucoes_total: 0,
}
const version: AdminIntegracaoVersao = {
  id: 'v1', versao: 1, ambiente: 'producao', status: 'rascunho', adapter_key: 'sinqia_portal_fidc',
  capabilities: ['CESSAO_ENVIO'], active_capabilities: [], identificador_cliente: '', codigo_originador: null,
  endpoint_base: '', configuracao_nao_sensivel: {}, credencial_integracao_id: null, vigente_desde: '', vigente_ate: null,
  publicada_em: null, created_at: '', updated_at: '',
}
describe('Envios Operacionais - cadastro, ativacao e prontidao separados', () => {
  beforeEach(() => resolver.mockResolvedValue({ status: 'NAO_CONFIGURADA', reason: 'CAPABILITY_SEM_FONTE' }))
  it('sem conector cadastrado nao oferece CNAB', async () => {
    expect(renderToStaticMarkup(await FundoEnviosOperacionais({ state: base }))).not.toContain('FORMULARIO CNAB')
  })
  it('Sinqia em rascunho permite parametrizar mas nao aparece configurada', async () => {
    const state: AdminConfiguracoesTecnicasFundo = { ...base, integracoes: [{
      id: 'i1', nome: 'QA', provedor: 'SINQIA', provider_key: 'SINQIA', system_name: 'QA', status: 'rascunho',
      created_at: '', updated_at: '', versoes: [version],
    }] }
    const html = renderToStaticMarkup(await FundoEnviosOperacionais({ state }))
    expect(html).toContain('FORMULARIO CNAB')
    expect(html).toContain('Nao configurado')
  })
  it('Sinqia ativa sem CNAB informa bloqueio de remessa, nao da integracao', async () => {
    resolver.mockResolvedValue({ status: 'CONFIGURADA', integrationVersion: { adapterKey: 'sinqia_portal_fidc', systemName: 'Sinqia', version: 1 } })
    const html = renderToStaticMarkup(await FundoEnviosOperacionais({ state: base }))
    expect(html).toContain('FORMULARIO CNAB')
    expect(html).toContain('Integracao ativa. Publique o CNAB')
    expect(html).toContain('Nao configurado')
  })
  it('VRS CSV nao pede CNAB', async () => {
    resolver.mockResolvedValue({ status: 'CONFIGURADA', integrationVersion: { adapterKey: 'vortx_vrs', systemName: 'VRS', version: 1 } })
    const html = renderToStaticMarkup(await FundoEnviosOperacionais({ state: base }))
    expect(html).not.toContain('FORMULARIO CNAB')
    expect(html).toContain('Parametrizacao CNAB nao se aplica')
    expect(html).toContain('Configurado')
  })
})
