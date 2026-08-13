import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { adminCnabRascunhoSchema, adminCredencialSchema, adminIntegracaoRascunhoSchema } from '@/lib/admin/configuracoes-tecnicas'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('SA3 - configuracoes tecnicas por fundo', () => {
  it('valida credenciais e preserva codigo originador como texto', () => {
    expect(adminCredencialSchema.safeParse({ fundoId: crypto.randomUUID(), ambiente: 'homologacao', nome: 'Portal HML', usuario: 'user', senha: 'secret', mfaCode: '123456' }).success).toBe(true)
    const parsed = adminCnabRascunhoSchema.safeParse({ fundoId: crypto.randomUUID(), configuracaoId: null, versaoId: null, codigo: 'cnab_principal', nome: 'CNAB', descricao: null, layout: 'cnab444', versaoLayout: '1', codigoBanco: '001', banco: 'Banco', agencia: '0001', conta: '0000123', digitoConta: '0', carteira: '1', convenio: '0002', codigoOriginador: '000000500497', codigoEmpresa: '0003', tipoInscricao: '2', numeroInscricao: '00123456000100', especieTitulo: 'DM', tipoRecebivel: 'duplicata', configuracao: {}, updatedAtEsperado: null, mfaCode: '123456' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.codigoOriginador).toBe('000000500497')
  })

  it('valida estrutura da integracao antes da validacao server-side do endpoint', () => {
    expect(adminIntegracaoRascunhoSchema.safeParse({ fundoId: crypto.randomUUID(), ambiente: 'producao', endpointBase: 'http://example.com', identificadorCliente: 'cliente', credencialIntegracaoId: crypto.randomUUID(), configuracaoNaoSensivel: {}, mfaCode: '123456' }).success).toBe(true)
    expect(adminIntegracaoRascunhoSchema.safeParse({ fundoId: crypto.randomUUID(), ambiente: 'producao', endpointBase: 'https://example.com', identificadorCliente: 'cliente', configuracaoNaoSensivel: {}, mfaCode: '12' }).success).toBe(false)
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
    expect(actions.match(/context\.supabase\.rpc\(/g)).toHaveLength(10)
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

  it('carrega configuracoes tecnicas apenas nas abas Integracoes e CNAB', () => {
    const page = source('src/app/admin/fundos/[id]/page.tsx')
    expect(page).toContain("tab === 'integracoes' || tab === 'cnab'")
    expect(page).toContain('<FundoIntegracoesTecnicas state={technical}')
    expect(page).toContain('<FundoCnabTecnico state={technical}')
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

  it('nao retorna ciphertext nos DTOs administrativos', () => {
    const dto = source('src/lib/admin/configuracoes-tecnicas.ts')
    expect(dto).not.toMatch(/senha_criptografada|usuario_criptografado/)
    expect(dto).toContain('usuario_mascarado')
  })
})
