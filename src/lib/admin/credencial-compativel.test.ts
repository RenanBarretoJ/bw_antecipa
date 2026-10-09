import { describe, expect, it } from 'vitest'
import { credencialCompativel, type ContextoCredencial } from './credencial-compativel'
import { adminCredencialSchema, adminIntegracaoRascunhoSchema, type AdminCredencialIntegracao } from './configuracoes-tecnicas'

const fundoId = '00000000-0000-4000-8000-000000000001'
const integrationId = '00000000-0000-4000-8000-000000000002'
const credential: AdminCredencialIntegracao = {
  id: '00000000-0000-4000-8000-000000000003', fundo_id: fundoId, integracao_fundo_id: null,
  provider_key: 'SINQIA', credential_type: 'usuario_senha', capabilities: ['ESTOQUE'],
  ambiente: 'homologacao', status: 'ativa', nome: 'QA', chave_versao: 'v1', criada_em: '',
  ativada_em: '', revogada_em: null, substituida_por: null, ultimo_uso_em: null,
  usuario_mascarado: 'q***', created_at: '', updated_at: '',
}
const context: ContextoCredencial = {
  fundoId, integrationId, providerKey: 'SINQIA', environment: 'homologacao',
  adapterKey: 'sinqia_portal_fidc', capabilities: ['ESTOQUE'],
}

describe('credencial previa e primeiro vinculo', () => {
  it('aceita credencial previa e credencial vinculada a mesma integracao', () => {
    expect(credencialCompativel(credential, context)).toBe(true)
    expect(credencialCompativel({ ...credential, integracao_fundo_id: integrationId }, context)).toBe(true)
  })
  it.each<Partial<AdminCredencialIntegracao>>([
    { fundo_id: 'outro' }, { integracao_fundo_id: 'outra' }, { provider_key: 'OUTRO' },
    { ambiente: 'producao' }, { status: 'rascunho' }, { status: 'revogada' },
    { status: 'substituida' }, { revogada_em: '2026-10-01' }, { capabilities: [] },
  ])('nega incompatibilidade %j', (change) => {
    expect(credencialCompativel({ ...credential, ...change }, context)).toBe(false)
  })
  it('nao usa usuario/senha em adapter mTLS', () => {
    expect(credencialCompativel({ ...credential, provider_key: 'VORTX' }, { ...context, providerKey: 'VORTX', adapterKey: 'vortx_vrs' })).toBe(false)
  })
  it('cria antes da integracao, exigindo provider e MFA', () => {
    const input = { fundoId, integracaoFundoId: null, providerKey: 'sinqia', ambiente: 'homologacao', nome: 'QA', usuario: 'qa', senha: 'synthetic', mfaCode: '123456' }
    expect(adminCredencialSchema.safeParse(input).success).toBe(true)
    expect(adminCredencialSchema.safeParse({ ...input, providerKey: undefined }).success).toBe(false)
    expect(adminCredencialSchema.safeParse({ ...input, mfaCode: undefined }).success).toBe(false)
  })
})

describe('regressao do timestamp PostgreSQL no vinculo', () => {
  const input = { fundoId, integracaoFundoId: integrationId, versaoId: integrationId,
    providerKey: 'SINQIA', systemName: 'Portal FIDC', adapterKey: 'sinqia_portal_fidc',
    capabilities: ['ESTOQUE'], ambiente: 'homologacao', endpointBase: '', identificadorCliente: '',
    credencialIntegracaoId: credential.id }
  it.each(['2026-09-30T22:01:31.748866+00:00', '2026-09-30T19:01:31.748866-03:00', '2026-09-30T22:01:31.748866Z'])(
    'aceita e preserva exatamente %s', (timestamp) => {
      const result = adminIntegracaoRascunhoSchema.safeParse({ ...input, updatedAtEsperado: timestamp })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.updatedAtEsperado).toBe(timestamp)
    },
  )
  it.each(['2026-09-30T22:01:31', 'invalid', '2026-13-30T22:01:31Z'])('rejeita timestamp invalido %s', (timestamp) => {
    expect(adminIntegracaoRascunhoSchema.safeParse({ ...input, updatedAtEsperado: timestamp }).success).toBe(false)
  })
})
