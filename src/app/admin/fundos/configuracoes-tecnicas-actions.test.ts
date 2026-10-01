import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, from, requireSuperAdmin } = vi.hoisted(() => {
  const rpc = vi.fn()
  const from = vi.fn()
  return {
    rpc,
    from,
    requireSuperAdmin: vi.fn(async () => ({
      supabase: { rpc, from },
      profile: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })),
  }
})

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/admin-authorization', () => ({ requireSuperAdmin }))
vi.mock('@/lib/auth/sensitive-action', () => ({ autorizarEConsumirAcaoSensivel: vi.fn() }))
vi.mock('@/lib/admin/endpoint-seguro.server', () => ({ validarEndpointTecnicoSeguro: vi.fn() }))
vi.mock('@/lib/integracoes/registry.server', () => ({ integrationProviderRegistry: { get: vi.fn() } }))
vi.mock('@/lib/portal-fidc/credenciais', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/portal-fidc/credenciais')>(),
  getPortalFidcEncryptionKey: vi.fn(),
  criptografarPortalFidcValor: vi.fn(),
  descriptografarPortalFidcValor: vi.fn(),
}))

import { integrationProviderRegistry } from '@/lib/integracoes/registry.server'
import { getPortalFidcEncryptionKey, criptografarPortalFidcValor, PortalFidcKeyringError } from '@/lib/portal-fidc/credenciais'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import { publicarIntegracaoAdmin, salvarIntegracaoRascunhoAdmin, salvarCnabRascunhoAdmin } from './configuracoes-tecnicas-actions'
import { calcularHashConfiguracaoCnab } from '@/lib/cnab/domain'
import { normalizarConfiguracaoCnabInput } from '@/lib/cnab/resolver-configuracao'

// UUID real aceito pelo PostgreSQL, mas sem nibble RFC de versao/variante.
const fundoId = 'e84fdd30-39ed-de86-292e-0d8d9d92d759'
const integrationId = '22222222-2222-4222-8222-222222222222'
const versionId = '33333333-3333-4333-8333-333333333333'

describe('persistencia CNAB compativel com geracao', () => {
  it('salva conteudo normalizado com o mesmo hash usado pelo resolver da remessa', async () => {
    vi.clearAllMocks()
    rpc.mockResolvedValue({ data: { id: versionId }, error: null })
    const cnab = {
      layout: 'cnab444' as const, versaoLayout: '1', codigoBanco: '001', banco: 'banco qa', agencia: '0001', conta: '00002', digitoConta: 'x',
      carteira: '001', convenio: '00003', codigoOriginador: '00004', codigoEmpresa: '00005', tipoInscricao: '02', numeroInscricao: '98.000.000/0001-68',
      especieTitulo: '01', tipoRecebivel: '01', configuracao: { literalRemessa: 'remessa' },
    }
    const result = await salvarCnabRascunhoAdmin({ ...cnab, fundoId, codigo: 'qa_cnab', nome: 'QA CNAB' })
    const normalized = normalizarConfiguracaoCnabInput(cnab)
    expect(result.success).toBe(true)
    expect(rpc).toHaveBeenCalledWith('admin_salvar_cnab_rascunho', expect.objectContaining({
      p_conteudo_hash: calcularHashConfiguracaoCnab(normalized), p_banco: 'BANCO QA', p_numero_inscricao: '98000000000168',
      p_digito_conta: 'X', p_codigo_originador: '00004', p_configuracao: normalized.configuracao,
    }))
  })
})

const base = {
  fundoId,
  integracaoFundoId: null,
  versaoId: null,
  providerKey: 'CUSTOM',
  systemName: 'PORTAL FIDC',
  adapterKey: null,
  capabilities: [],
  ambiente: 'homologacao',
  endpointBase: '',
  identificadorCliente: '',
  credencialIntegracaoId: null,
  configuracaoNaoSensivel: {},
  updatedAtEsperado: null,
}

describe('salvar rascunho de integracao tecnica', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockImplementation((nome: string) => {
      if (nome === 'admin_obter_configuracoes_tecnicas_fundo') {
        return Promise.resolve({
          data: { integracoes: [{ id: integrationId, versoes: [] }], credenciais: [] },
          error: null,
        })
      }
      if (nome === 'admin_salvar_integracao_rascunho') {
        return Promise.resolve({ data: { id: versionId, integracao_id: integrationId }, error: null })
      }
      throw new Error(`RPC inesperada em teste: ${nome}`)
    })
    from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { cnpj: '68.522.785/0001-04' }, error: null }),
        }),
      }),
    })
  })

  it('usa CREATE com IDs nulos e permite draft incompleto', async () => {
    const result = await salvarIntegracaoRascunhoAdmin({
      ...base,
      endpointBase: 'https://teste.com.br',
      identificadorCliente: 'teste',
    })

    expect(result).toMatchObject({
      success: true,
      message: 'Rascunho criado com sucesso.',
      data: { id: versionId, integrationId },
    })
    expect(rpc).toHaveBeenCalledWith('admin_salvar_integracao_rascunho', expect.objectContaining({
      p_fundo_id: fundoId,
      p_integracao_fundo_id: null,
      p_versao_id: null,
      p_adapter_key: null,
      p_capabilities: [],
      p_endpoint_base: 'https://teste.com.br/',
      p_identificador_cliente: 'teste',
      p_credencial_integracao_id: null,
    }))
  })

  it('salva autenticacao cifrada e rascunho em uma unica RPC com MFA', async () => {
    vi.mocked(criptografarPortalFidcValor).mockReturnValue({ ciphertext: 'v1:QA:QA:QA', chaveVersao: 'qa' })
    rpc.mockResolvedValue({ data: { id: versionId, integracao_id: integrationId }, error: null })
    const result = await salvarIntegracaoRascunhoAdmin({
      ...base, providerKey: 'SINQIA', systemName: 'Portal FIDC', adapterKey: 'sinqia_portal_fidc',
      capabilities: ['CESSAO_ENVIO'],
      novaCredencial: { nome: 'QA', usuario: 'usuario-qa', senha: 'senha-qa-local', mfaCode: '123456' },
    })
    expect(result.success).toBe(true)
    expect(autorizarEConsumirAcaoSensivel).toHaveBeenCalledWith(expect.anything(), 'cadastrar_credencial_integracao', '123456')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('admin_salvar_integracao_com_credencial', expect.objectContaining({
      p_usuario_criptografado: 'v1:QA:QA:QA', p_senha_criptografada: 'v1:QA:QA:QA', p_capabilities: ['CESSAO_ENVIO'],
    }))
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('senha-qa-local')
    expect(JSON.stringify(result)).not.toContain('v1:QA')
  })

  it('falha de keyring nao consome TOTP nem persiste rascunho ou credencial', async () => {
    vi.mocked(getPortalFidcEncryptionKey).mockImplementationOnce(() => { throw new PortalFidcKeyringError() })
    const result = await salvarIntegracaoRascunhoAdmin({
      ...base, providerKey: 'SINQIA', systemName: 'Portal FIDC', adapterKey: 'sinqia_portal_fidc',
      novaCredencial: { nome: 'QA', usuario: 'qa', senha: 'qa-local', mfaCode: '123456' },
    })
    expect(result.success).toBe(false)
    expect(result.message).toContain('Chave de criptografia')
    expect(rpc).not.toHaveBeenCalled()
    expect(autorizarEConsumirAcaoSensivel).not.toHaveBeenCalled()
  })

  it.each([
    { providerKey: 'OUTRO', adapterKey: 'sinqia_portal_fidc', capabilities: [] },
    { providerKey: 'SINQIA', adapterKey: 'sinqia_portal_fidc', capabilities: ['CARTEIRA'] },
    { providerKey: 'VORTX', systemName: 'Vórtx VRS 2.0', adapterKey: 'vortx_vrs', capabilities: [] },
    { providerKey: 'CUSTOM', adapterKey: null, capabilities: [] },
  ])('rejeita contrato de autenticacao adulterado: %j', async (override) => {
    const result = await salvarIntegracaoRascunhoAdmin({
      ...base, systemName: 'Portal FIDC', ...override,
      novaCredencial: { nome: 'QA', usuario: 'qa', senha: 'qa-local', mfaCode: '123456' },
    })
    expect(result.success).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('permite CREATE sem endpoint, adapter, credencial ou capability', async () => {
    const result = await salvarIntegracaoRascunhoAdmin({ ...base, systemName: 'TESTE QA' })

    expect(result).toMatchObject({ success: true, message: 'Rascunho criado com sucesso.' })
    expect(rpc).toHaveBeenCalledWith('admin_salvar_integracao_rascunho', expect.objectContaining({
      p_integracao_fundo_id: null,
      p_versao_id: null,
      p_adapter_key: null,
      p_capabilities: [],
      p_endpoint_base: '',
      p_credencial_integracao_id: null,
    }))
  })

  it('usa EDIT no segundo save com a mesma integracao e versao', async () => {
    const result = await salvarIntegracaoRascunhoAdmin({
      ...base,
      integracaoFundoId: integrationId,
      versaoId: versionId,
      systemName: 'PORTAL FIDC AJUSTADO',
    })

    expect(result).toMatchObject({ success: true, message: 'Rascunho atualizado com sucesso.' })
    expect(rpc).toHaveBeenCalledWith('admin_salvar_integracao_rascunho', expect.objectContaining({
      p_integracao_fundo_id: integrationId,
      p_versao_id: versionId,
      p_system_name: 'PORTAL FIDC AJUSTADO',
    }))
  })

  it('preserva o adapter definido no historico publicado ao criar nova versao', async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === 'admin_obter_configuracoes_tecnicas_fundo') {
        return Promise.resolve({
          data: {
            integracoes: [{
              id: integrationId,
              versoes: [{ status: 'publicada', adapter_key: 'vortx_vrs' }],
            }],
            credenciais: [],
          },
          error: null,
        })
      }
      if (nome === 'admin_salvar_integracao_rascunho') {
        return Promise.resolve({ data: { id: versionId, integracao_id: integrationId }, error: null })
      }
      throw new Error(`RPC inesperada em teste: ${nome}`)
    })

    const result = await salvarIntegracaoRascunhoAdmin({
      ...base,
      integracaoFundoId: integrationId,
      adapterKey: 'vortx_vrs',
      providerKey: 'VORTX',
      systemName: 'Vórtx VRS 2.0',
      capabilities: ['CESSAO_ENVIO'],
    })

    expect(result.success).toBe(true)
    expect(rpc).toHaveBeenCalledWith('admin_salvar_integracao_rascunho', expect.objectContaining({
      p_adapter_key: 'vortx_vrs',
    }))
  })

  it('rejeita adapter ausente quando a integracao ja possui adapter publicado', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        integracoes: [{
          id: integrationId,
          versoes: [{ status: 'publicada', adapter_key: 'vortx_vrs' }],
        }],
        credenciais: [],
      },
      error: null,
    })

    const result = await salvarIntegracaoRascunhoAdmin({
      ...base,
      integracaoFundoId: integrationId,
      adapterKey: null,
    })

    expect(result).toMatchObject({ success: false, message: 'O adapter da integracao publicada deve ser preservado na nova versao.' })
    expect(rpc).not.toHaveBeenCalledWith('admin_salvar_integracao_rascunho', expect.anything())
  })

  it('rejeita troca do adapter depois da primeira publicacao', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        integracoes: [{
          id: integrationId,
          versoes: [{ status: 'publicada', adapter_key: 'vortx_vrs' }],
        }],
        credenciais: [],
      },
      error: null,
    })

    const result = await salvarIntegracaoRascunhoAdmin({
      ...base,
      integracaoFundoId: integrationId,
      adapterKey: 'sinqia_portal_fidc',
      providerKey: 'SINQIA',
      systemName: 'Portal FIDC',
    })

    expect(result).toMatchObject({ success: false, message: 'O adapter de uma integracao publicada nao pode ser alterado em uma nova versao.' })
    expect(rpc).not.toHaveBeenCalledWith('admin_salvar_integracao_rascunho', expect.anything())
  })

  it('mantem compatibilidade com integracao Custom publicada sem adapter', async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === 'admin_obter_configuracoes_tecnicas_fundo') {
        return Promise.resolve({
          data: {
            integracoes: [{
              id: integrationId,
              versoes: [{ status: 'publicada', adapter_key: null }],
            }],
            credenciais: [],
          },
          error: null,
        })
      }
      if (nome === 'admin_salvar_integracao_rascunho') {
        return Promise.resolve({ data: { id: versionId, integracao_id: integrationId }, error: null })
      }
      throw new Error(`RPC inesperada em teste: ${nome}`)
    })

    const result = await salvarIntegracaoRascunhoAdmin({
      ...base,
      integracaoFundoId: integrationId,
      adapterKey: null,
    })

    expect(result.success).toBe(true)
    expect(rpc).toHaveBeenCalledWith('admin_salvar_integracao_rascunho', expect.objectContaining({
      p_adapter_key: null,
    }))
  })

  it('deriva o CNPJ financeiro do cadastro do fundo e preserva os demais parametros', async () => {
    const result = await salvarIntegracaoRascunhoAdmin({
      ...base,
      adapterKey: 'sinqia_portal_fidc',
      providerKey: 'SINQIA',
      systemName: 'Portal FIDC',
      capabilities: ['ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'],
      configuracaoNaoSensivel: {
        relatorios_financeiros: { intervalo_polling_ms: 5000 },
        parametro_adicional: true,
      },
    })

    expect(result.success).toBe(true)
    expect(from).toHaveBeenCalledWith('fundos')
    expect(rpc).toHaveBeenCalledWith('admin_salvar_integracao_rascunho', expect.objectContaining({
      p_configuracao_nao_sensivel: {
        relatorios_financeiros: {
          intervalo_polling_ms: 5000,
          cnpj_fundo: '68522785000104',
        },
        parametro_adicional: true,
      },
    }))
  })

  it('nao consulta o cadastro do fundo quando o rascunho possui somente cessao', async () => {
    const result = await salvarIntegracaoRascunhoAdmin({
      ...base,
      adapterKey: 'sinqia_portal_fidc',
      providerKey: 'SINQIA',
      systemName: 'Portal FIDC',
      capabilities: ['CESSAO_ENVIO'],
    })

    expect(result.success).toBe(true)
    expect(from).not.toHaveBeenCalled()
  })

  it('bloqueia sentinel frontend antes de consultar o Supabase', async () => {
    const result = await salvarIntegracaoRascunhoAdmin({ ...base, integracaoFundoId: 'new' })

    expect(result).toMatchObject({ success: false, message: 'A integracao selecionada e invalida.' })
    expect(requireSuperAdmin).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('publicar integracao Vortx VRS 2.0', () => {
  const vortxAdapter = {
    label: 'Vórtx — VRS 2.0',
    supports: ['CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'],
    requiresCredential: false,
    requiresEndpoint: false,
    validatePublication: () => null,
  }

  const vortxVersao = {
    id: versionId,
    status: 'rascunho',
    adapter_key: 'vortx_vrs',
    ambiente: 'homologacao',
    capabilities: ['CESSAO_ENVIO'],
    identificador_cliente: '',
    codigo_originador: null,
    endpoint_base: '',
    configuracao_nao_sensivel: {},
    credencial_integracao_id: null,
  }

  const estadoComVersaoVortx = {
    integracoes: [{ id: integrationId, versoes: [vortxVersao] }],
    credenciais: [],
  }

  function configurarRpc(vortxConfig: Array<{ ambiente: string; status: string }>, publicarError: unknown = null) {
    rpc.mockImplementation((nome: string) => {
      if (nome === 'admin_obter_configuracoes_tecnicas_fundo') return Promise.resolve({ data: estadoComVersaoVortx, error: null })
      if (nome === 'admin_obter_configuracao_vortx_vrs') return Promise.resolve({ data: vortxConfig, error: null })
      if (nome === 'admin_publicar_integracao_versao') return Promise.resolve({ data: null, error: publicarError })
      throw new Error(`RPC inesperada em teste: ${nome}`)
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(integrationProviderRegistry.get).mockReturnValue(vortxAdapter as never)
  })

  it('bloqueia publicacao quando nao ha credencial Vortx ativa para o ambiente da versao', async () => {
    configurarRpc([])
    const result = await publicarIntegracaoAdmin({ fundoId, id: versionId, mfaCode: '123456' })

    expect(result).toMatchObject({ success: false, message: 'Configure e valide a credencial Vortx VRS deste ambiente antes de publicar.' })
    expect(rpc).not.toHaveBeenCalledWith('admin_publicar_integracao_versao', expect.anything())
  })

  it('bloqueia publicacao quando a credencial ativa e de outro ambiente', async () => {
    configurarRpc([{ ambiente: 'producao', status: 'ativa' }])
    const result = await publicarIntegracaoAdmin({ fundoId, id: versionId, mfaCode: '123456' })

    expect(result.success).toBe(false)
    expect(rpc).not.toHaveBeenCalledWith('admin_publicar_integracao_versao', expect.anything())
  })

  it('permite publicacao quando ha credencial Vortx ativa no mesmo ambiente da versao', async () => {
    configurarRpc([{ ambiente: 'homologacao', status: 'ativa' }])
    const result = await publicarIntegracaoAdmin({ fundoId, id: versionId, mfaCode: '123456' })

    expect(result).toMatchObject({ success: true })
    expect(rpc).toHaveBeenCalledWith('admin_publicar_integracao_versao', expect.objectContaining({ p_fundo_id: fundoId, p_versao_id: versionId }))
  })
})
