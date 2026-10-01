import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import type { AdminIntegracao, AdminIntegracaoVersao } from './configuracoes-tecnicas'
import { podeParametrizarCnab } from './cnab-availability.server'

const version: AdminIntegracaoVersao = {
  id: 'v1', versao: 1, ambiente: 'producao', status: 'rascunho', adapter_key: 'sinqia_portal_fidc',
  capabilities: ['CESSAO_ENVIO'], active_capabilities: [], identificador_cliente: '', codigo_originador: null,
  endpoint_base: '', configuracao_nao_sensivel: {}, credencial_integracao_id: null, vigente_desde: '', vigente_ate: null,
  publicada_em: null, created_at: '', updated_at: '',
}
function fixture(changes: Partial<AdminIntegracaoVersao> = {}): AdminIntegracao[] {
  return [{ id: 'i1', provedor: 'SINQIA', provider_key: 'SINQIA', system_name: 'QA', nome: 'QA', status: 'rascunho', created_at: '', updated_at: '', versoes: [{ ...version, ...changes }] }]
}
describe('parametrizacao CNAB depois do cadastro', () => {
  it('sem integracao nao exibe formulario', () => expect(podeParametrizarCnab([], 'producao', null)).toBe(false))
  it('rascunho Sinqia permite parametrizar sem fingir ativacao', () => expect(podeParametrizarCnab(fixture(), 'producao', null)).toBe(true))
  it('Sinqia ativa permite parametrizar', () => expect(podeParametrizarCnab(fixture(), 'producao', 'sinqia_portal_fidc')).toBe(true))
  it('VRS CSV ativo nao herda CNAB de rascunho Sinqia', () => expect(podeParametrizarCnab(fixture(), 'producao', 'vortx_vrs')).toBe(false))
  it('VRS CSV em rascunho nao exige CNAB', () => expect(podeParametrizarCnab(fixture({ adapter_key: 'vortx_vrs' }), 'producao', null)).toBe(false))
  it('isola ambientes e capacidades', () => {
    expect(podeParametrizarCnab(fixture(), 'homologacao', null)).toBe(false)
    expect(podeParametrizarCnab(fixture({ capabilities: ['ESTOQUE'] }), 'producao', null)).toBe(false)
  })
  it.each(['cancelada', 'substituida'])('nao usa versao %s', (status) => expect(podeParametrizarCnab(fixture({ status }), 'producao', null)).toBe(false))
})
