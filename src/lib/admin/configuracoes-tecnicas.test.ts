import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  adminCnabRascunhoSchema,
  adminCredencialSchema,
  adminIntegracaoRascunhoSchema,
  adminTechnicalConfirmationSchema,
  obterAcoesCredencial,
  obterPendenciaPublicacaoIntegracao,
  type AdminCredencialIntegracao,
  type AdminIntegracaoVersao,
} from '@/lib/admin/configuracoes-tecnicas'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('SA3 - configuracoes tecnicas por fundo', () => {
  it('valida credenciais e preserva codigo originador como texto', () => {
    expect(adminCredencialSchema.safeParse({ fundoId: crypto.randomUUID(), integracaoFundoId: crypto.randomUUID(), ambiente: 'homologacao', nome: 'Portal HML', usuario: 'user', senha: 'secret', mfaCode: '123456' }).success).toBe(true)
    const parsed = adminCnabRascunhoSchema.safeParse({ fundoId: crypto.randomUUID(), configuracaoId: null, versaoId: null, codigo: 'cnab_principal', nome: 'CNAB', descricao: null, layout: 'cnab444', versaoLayout: '1', codigoBanco: '001', banco: 'Banco', agencia: '0001', conta: '0000123', digitoConta: '0', carteira: '1', convenio: '0002', codigoOriginador: '000000500497', codigoEmpresa: '0003', tipoInscricao: '2', numeroInscricao: '00123456000100', especieTitulo: 'DM', tipoRecebivel: 'duplicata', configuracao: {}, updatedAtEsperado: null })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.codigoOriginador).toBe('000000500497')
  })

  it('permite rascunho de integracao incompleto, sem credencial, endpoint ou TOTP', () => {
    const parsed = adminIntegracaoRascunhoSchema.safeParse({
      fundoId: crypto.randomUUID(),
      integracaoFundoId: null,
      providerKey: 'CUSTOM',
      systemName: 'Sistema futuro',
      adapterKey: null,
      capabilities: [],
      ambiente: 'homologacao',
      endpointBase: '',
      identificadorCliente: '',
      credencialIntegracaoId: '',
      configuracaoNaoSensivel: {},
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.credencialIntegracaoId).toBeNull()
      expect(parsed.data.capabilities).toEqual([])
    }
  })

  it('aceita UUID canonico do PostgreSQL sem impor bits RFC', () => {
    const parsed = adminIntegracaoRascunhoSchema.safeParse({
      fundoId: 'e84fdd30-39ed-de86-292e-0d8d9d92d759',
      integracaoFundoId: null,
      versaoId: null,
      providerKey: 'CUSTOM',
      systemName: 'PORTAL FIDC',
      adapterKey: null,
      capabilities: [],
      ambiente: 'homologacao',
      endpointBase: 'https://teste.com.br/',
      identificadorCliente: 'teste',
      credencialIntegracaoId: null,
      configuracaoNaoSensivel: {},
      updatedAtEsperado: null,
    })

    expect(parsed.success).toBe(true)
  })

  it('identifica separadamente fundo, integracao e versao invalidos', () => {
    const base = {
      fundoId: crypto.randomUUID(), integracaoFundoId: null, versaoId: null,
      providerKey: 'CUSTOM', systemName: 'PORTAL FIDC', adapterKey: null, capabilities: [],
      ambiente: 'homologacao', endpointBase: 'https://teste.com.br', identificadorCliente: 'teste',
      credencialIntegracaoId: null, configuracaoNaoSensivel: {}, updatedAtEsperado: null,
    }

    const fundo = adminIntegracaoRascunhoSchema.safeParse({ ...base, fundoId: 'new' })
    const integracao = adminIntegracaoRascunhoSchema.safeParse({ ...base, integracaoFundoId: 'new' })
    const versao = adminIntegracaoRascunhoSchema.safeParse({ ...base, versaoId: 'new' })

    expect(fundo.success ? null : fundo.error.issues[0]?.message).toBe('FUNDO_ID_INVALIDO')
    expect(integracao.success ? null : integracao.error.issues[0]?.message).toBe('INTEGRACAO_ID_INVALIDO')
    expect(versao.success ? null : versao.error.issues[0]?.message).toBe('VERSAO_ID_INVALIDO')
  })

  it('bloqueia URL malformada no rascunho e permite HTTP para completar depois', () => {
    const base = { fundoId: crypto.randomUUID(), integracaoFundoId: null, providerKey: 'CUSTOM', systemName: 'Sistema futuro', adapterKey: null, capabilities: ['ESTOQUE'], ambiente: 'producao', identificadorCliente: '', credencialIntegracaoId: null, configuracaoNaoSensivel: {} }
    expect(adminIntegracaoRascunhoSchema.safeParse({ ...base, endpointBase: 'http://example.com' }).success).toBe(true)
    expect(adminIntegracaoRascunhoSchema.safeParse({ ...base, endpointBase: 'endpoint-invalido' }).success).toBe(false)
  })

  it('bloqueia configuracao JSON que nao seja objeto', () => {
    const parsed = adminIntegracaoRascunhoSchema.safeParse({
      fundoId: crypto.randomUUID(),
      integracaoFundoId: null,
      providerKey: 'CUSTOM',
      systemName: 'Sistema futuro',
      adapterKey: null,
      capabilities: ['ESTOQUE'],
      ambiente: 'homologacao',
      endpointBase: '',
      identificadorCliente: '',
      credencialIntegracaoId: null,
      configuracaoNaoSensivel: ['valor-invalido'],
    })
    expect(parsed.success).toBe(false)
  })

  it('mantem TOTP obrigatorio para publicar, testar ou desativar', () => {
    const confirmation = {
      fundoId: crypto.randomUUID(),
      id: crypto.randomUUID(),
    }
    expect(adminTechnicalConfirmationSchema.safeParse(confirmation).success).toBe(false)
    expect(adminTechnicalConfirmationSchema.safeParse({ ...confirmation, mfaCode: '123456' }).success).toBe(true)
  })

  it('separa pendencias de publicacao da validacao permissiva do rascunho', () => {
    const base = {
      id: crypto.randomUUID(), versao: 1, ambiente: 'homologacao' as const, status: 'rascunho',
      adapter_key: 'sinqia_portal_fidc', capabilities: ['CESSAO_ENVIO'] as const, active_capabilities: [] as const,
      endpoint_base: '', identificador_cliente: '', codigo_originador: null,
      credencial_integracao_id: null, configuracao_nao_sensivel: {}, vigente_desde: '', vigente_ate: null,
      publicada_em: null, created_at: '', updated_at: '',
    } satisfies AdminIntegracaoVersao
    expect(obterPendenciaPublicacaoIntegracao(base, [])).toBe('Informe o endpoint HTTPS antes de publicar.')

    const credencial = {
      id: crypto.randomUUID(), integracao_fundo_id: crypto.randomUUID(), ambiente: 'homologacao' as const,
      nome: 'Portal HML', status: 'ativa' as const, chave_versao: 'v1', criada_em: '', ativada_em: '',
      revogada_em: null, substituida_por: null, ultimo_uso_em: null, usuario_mascarado: 'us**io',
      created_at: '', updated_at: '',
    } satisfies AdminCredencialIntegracao
    const completa = { ...base, endpoint_base: 'https://portal.example.com', identificador_cliente: 'cliente', codigo_originador: '0001', credencial_integracao_id: credencial.id }
    expect(obterPendenciaPublicacaoIntegracao(completa, [credencial])).toBeNull()
  })

  it('remove edicao tecnica do Gestor e preserva redirects legados', () => {
    const actions = source('src/lib/actions/configuracoes-cnab.ts')
    const sidebar = source('src/components/auth/sidebar.tsx')
    const oldFund = source('src/app/gestor/fundos/[id]/page.tsx')
    const managerMenu = sidebar.slice(sidebar.indexOf('export const gestorMenuItems'), sidebar.indexOf('export const cedenteMenuItems'))
    expect(actions).toContain('Configuracao tecnica restrita ao Super Admin')
    expect(actions).not.toMatch(/createAdminClient|service[_-]?role/i)
    expect(managerMenu).not.toContain("href: '/gestor/fundos'")
    expect(managerMenu).not.toContain("href: '/gestor/comunicacoes'")
    expect(oldFund).toContain("redirect('/gestor/configuracoes")
  })

  it('mantem mutacoes em RPCs administrativas com MFA e grants minimos', () => {
    const migration = source('supabase/migrations/20260812190000_sa3_admin_configuracoes_tecnicas.sql')
    const actions = source('src/app/admin/fundos/configuracoes-tecnicas-actions.ts')
    expect(migration).toContain('private.usuario_e_super_admin()')
    expect(migration).toContain('REVOKE ALL ON TABLE public.configuracoes_cnab FROM authenticated')
    expect(migration).toContain('p_execucoes_offset integer DEFAULT 0')
    expect(migration).toContain('pg_catalog.pg_get_function_identity_arguments(p.oid)')
    expect(migration).not.toContain('public.admin_salvar_cnab_rascunho(uuid,uuid,uuid')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION %s TO authenticated')
    expect(actions).toContain('autorizarEConsumirAcaoSensivel')
    expect(actions).not.toMatch(/createAdminClient|service[_-]?role/i)
  })

  it('preserva o receiver do cliente Supabase em todas as RPCs do SA3', () => {
    const loader = source('src/lib/admin/configuracoes-tecnicas.server.ts')
    const actions = source('src/app/admin/fundos/configuracoes-tecnicas-actions.ts')
    const sa3Sources = `${loader}\n${actions}`

    expect(loader).toContain("context.supabase.rpc('admin_obter_configuracoes_tecnicas_fundo'")
    expect(actions.match(/context\.supabase\.rpc\(/g)).toHaveLength(12)
    expect(sa3Sources).not.toMatch(/const\s+\w+\s*=\s*context\.supabase\.rpc/)
    expect(sa3Sources).not.toMatch(/(?:supabase|client)\.rpc\s+as/)
    expect(sa3Sources).not.toContain('callAdminRpc')
    expect(sa3Sources).not.toContain('.rpc.bind(')
  })

  it('mantem as RPCs do SA3 no contrato tipado do banco', () => {
    const database = source('src/types/database.ts')
    const rpcNames = [
      'admin_obter_configuracoes_tecnicas_fundo',
      'admin_cadastrar_credencial_integracao',
      'admin_ativar_credencial_integracao',
      'admin_revogar_credencial_integracao',
      'admin_salvar_integracao_rascunho',
      'admin_publicar_integracao_versao',
      'admin_desativar_integracao_versao',
      'admin_salvar_cnab_rascunho',
      'admin_publicar_cnab_versao',
      'admin_desativar_cnab_versao',
      'admin_preparar_teste_integracao',
      'admin_finalizar_teste_integracao',
    ]

    for (const rpcName of rpcNames) expect(database).toContain(`${rpcName}:`)
  })

  it('carrega configuracoes tecnicas apenas nas abas Integracoes e Envios Operacionais', () => {
    const page = source('src/app/admin/fundos/[id]/page.tsx')
    expect(page).toContain("tab === 'integracoes' || tab === 'envios'")
    expect(page).toContain('<FundoIntegracoesTecnicas state={technical}')
    expect(page).toContain('<FundoEnviosOperacionais state={technical}')
    expect(page).toContain("requestedTab === 'cnab'")
    expect(page).toContain('tab=envios')
  })

  it('respeita os status canonicos e bloqueia CNAB operacional de fundo inativo', () => {
    const migration = source('supabase/migrations/20260812190000_sa3_admin_configuracoes_tecnicas.sql')
    const cnabRuntime = source('src/lib/cnab/gerarCnab444.ts')
    expect(migration).toContain("SET status = 'cancelada', vigente_ate")
    expect(migration).not.toContain("SET status = 'desativada', vigente_ate")
    expect(cnabRuntime).toContain('Fundo inativo nao pode gerar remessa CNAB operacional.')
  })

  it('limpa o formulario write-only depois de cadastrar credencial', () => {
    const ui = source('src/components/admin/fundo-integracoes-tecnicas.tsx')
    expect(ui).toContain('credentialFormRef.current?.reset()')
    expect(ui).not.toMatch(/value=\{[^}]*senha/i)
  })

  it('expoe somente as transicoes canonicas do ciclo de vida da credencial', () => {
    const ui = source('src/components/admin/fundo-integracoes-tecnicas.tsx')
    expect(obterAcoesCredencial('rascunho')).toEqual(['ativar'])
    expect(obterAcoesCredencial('ativa')).toEqual(['rotacionar', 'revogar'])
    expect(obterAcoesCredencial('substituida')).toEqual([])
    expect(obterAcoesCredencial('revogada')).toEqual([])
    expect(ui).toContain('obterAcoesCredencial(credential.status)')
    expect(ui).not.toContain("credential.status === 'pendente'")
    expect(ui).toContain("integrationCredentials.filter((item) => item.status === 'ativa')")
    expect(ui).toContain("pendingLabel={confirmation.kind === 'activate' ? 'Ativando...' : undefined}")
  })

  it('mantem ativacao atomica, auditada e sem exclusao da credencial anterior', () => {
    const migration = source('supabase/migrations/20260813103000_corrigir_ciclo_vida_credenciais_sa3.sql')
    const baseMigration = source('supabase/migrations/20260722145820_complemento_credenciais_portal_fidc_banco.sql')
    const actions = source('src/app/admin/fundos/configuracoes-tecnicas-actions.ts')
    expect(migration).toContain("v_cred.status NOT IN ('rascunho', 'ativa')")
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock')
    expect(migration).toContain('c.fundo_id = p_fundo_id')
    expect(migration).toContain("SET status = 'substituida'")
    expect(migration).toContain("SET status = 'ativa'")
    expect(migration).toContain("'CREDENCIAL_ATIVADA'")
    expect(migration).toContain("'ambiente', v_cred.ambiente")
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.credenciais_integracao/i)
    expect(baseMigration).toContain('uq_credenciais_integracao_ativa_por_ambiente')
    expect(actions).toContain("autorizarEConsumirAcaoSensivel(context, 'ativar_credencial_integracao', parsed.data.mfaCode)")
    expect(actions).toContain("return sucesso('Credencial ativada com sucesso.'")
  })

  it('mantem TOTP nas acoes efetivas e remove do salvamento de rascunhos', () => {
    const actions = source('src/app/admin/fundos/configuracoes-tecnicas-actions.ts')
    const integrationUi = source('src/components/admin/fundo-integracoes-tecnicas.tsx')
    const cnabUi = source('src/components/admin/fundo-cnab-tecnico.tsx')
    const migration = source('supabase/migrations/20260813150432_corrigir_semantica_rascunhos_sa3.sql')

    const integrationDraftAction = actions.slice(actions.indexOf('export async function salvarIntegracaoRascunhoAdmin'), actions.indexOf('async function validarIntegracaoParaPublicacao'))
    const cnabDraftAction = actions.slice(actions.indexOf('export async function salvarCnabRascunhoAdmin'), actions.indexOf('async function executarAcaoVersaoCnab'))
    expect(integrationDraftAction).not.toContain('autorizarEConsumirAcaoSensivel')
    expect(cnabDraftAction).not.toContain('autorizarEConsumirAcaoSensivel')
    expect(actions).toContain("acao === 'publicar' ? 'publicar_integracao' : 'desativar_integracao'")
    expect(actions).toContain("autorizarEConsumirAcaoSensivel(context, 'testar_integracao'")
    expect(actions).toContain("autorizarEConsumirAcaoSensivel(context, 'atualizar_cnab'")
    expect(integrationUi.match(/<Label>Codigo TOTP<\/Label>/g)).toHaveLength(1)
    expect(cnabUi).not.toContain('<Label>Codigo TOTP</Label>')
    expect(migration).toContain("COALESCE('credencial:' || p_credencial_integracao_id::text, 'nao_configurada')")
    expect(migration).toContain('Informe o endpoint HTTPS antes de publicar')
    expect(migration).toContain('Selecione uma credencial ativa antes de publicar')
  })

  it('preserva runtime somente em versoes publicadas de integracao e CNAB', () => {
    const portalRuntime = source('src/lib/portal-fidc/integracao.ts')
    const cnabRuntime = source('src/lib/cnab/resolver-configuracao.ts')
    const migration = source('supabase/migrations/20260813150432_corrigir_semantica_rascunhos_sa3.sql')

    expect(portalRuntime).toContain("capability: 'CESSAO_ENVIO'")
    expect(portalRuntime).toContain("resolved.status !== 'CONFIGURADA'")
    expect(cnabRuntime).toContain("versao.status === 'publicada'")
    expect(migration).toContain("AND v.status = 'rascunho'")
    expect(migration).toContain("SET status = 'substituida', vigente_ate = v_agora")
  })

  it('nao classifica hostname DNS publico como endereco IP privado', () => {
    const endpointValidator = source('src/lib/admin/endpoint-seguro.server.ts')

    expect(endpointValidator).toContain("family === 6 ? ipv6Privado(address) : false")
    expect(endpointValidator).toContain("await lookup(hostname, { all: true, verbatim: true })")
    expect(endpointValidator).toContain("addresses.some(({ address }) => enderecoRedePrivada(address))")
  })

  it('mantem os campos editaveis da integracao controlados apos refresh', () => {
    const ui = source('src/components/admin/fundo-integracoes-tecnicas.tsx')

    expect(ui).toContain('value={endpoint}')
    expect(ui).toContain('value={clientId}')
    expect(ui).toContain('value={config}')
    expect(ui).not.toContain('defaultValue={defaultVersion?.endpoint_base')
    expect(ui).not.toContain('defaultValue={defaultVersion?.identificador_cliente')
  })

  it('declara explicitamente os botoes submit porque o Button Base UI usa type button por padrao', () => {
    const integracoes = source('src/components/admin/fundo-integracoes-tecnicas.tsx')
    const cnab = source('src/components/admin/fundo-cnab-tecnico.tsx')

    expect(integracoes.match(/<Button type="submit"/g)).toHaveLength(2)
    expect(cnab.match(/<Button type="submit"/g)).toHaveLength(1)
    expect(integracoes).toContain('executarMutacaoTecnica')
    expect(cnab).toContain('executarMutacaoTecnica')
  })

  it('separa visualmente CREATE, EDIT e nenhuma selecao sem sentinel de UUID', () => {
    const ui = source('src/components/admin/fundo-integracoes-tecnicas.tsx')
    const lifecycle = source('src/lib/admin/integracao-editor.ts')

    expect(lifecycle).toContain("mode: 'none'")
    expect(lifecycle).toContain("mode: 'create'")
    expect(lifecycle).toContain("mode: 'edit'")
    expect(lifecycle).not.toContain("integrationId: 'new'")
    expect(lifecycle).not.toContain("integrationId: 'novo'")
    expect(ui).toContain('function beginCreateIntegration()')
    expect(ui).toContain("setEditor(newIntegrationEditorState())")
    expect(ui).toContain('setCreateFormGeneration((current) => current + 1)')
    expect(ui).toContain('onClick={beginCreateIntegration}')
    expect(ui).toContain("setEditor(editIntegrationEditorState(result.data.integrationId))")
    expect(ui).toContain("editor.mode === 'create' ? 'Nova integracao tecnica'")
    expect(ui).toContain('Nenhuma integracao selecionada')
  })

  it('nao retorna ciphertext nos DTOs administrativos', () => {
    const dto = source('src/lib/admin/configuracoes-tecnicas.ts')
    expect(dto).not.toMatch(/senha_criptografada|usuario_criptografado/)
    expect(dto).toContain('usuario_mascarado')
  })
})
