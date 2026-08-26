import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260826200000_p3_cutover_autorizacao_cedente.sql',
  'utf8',
)
const notificationsMigration = readFileSync(
  'supabase/migrations/20260826201000_p3_notificacoes_cedente_ativas.sql',
  'utf8',
)
const aclMigration = readFileSync(
  'supabase/migrations/20260826202000_p3_hardening_acl_rpcs_cedente.sql',
  'utf8',
)
const authorization = readFileSync('src/lib/auth/authorization.ts', 'utf8')
const cedenteActions = readFileSync('src/lib/actions/cedente.ts', 'utf8')
const estabelecimentoActions = readFileSync('src/lib/actions/estabelecimento.ts', 'utf8')
const escrow = readFileSync('src/lib/escrow/movimentos.server.ts', 'utf8')
const notificacoes = readFileSync('src/lib/actions/notificacao.ts', 'utf8')
const gestorActions = readFileSync('src/lib/actions/gestor.ts', 'utf8')

describe('P3: cutover de autorizacao ADMIN x OPERACIONAL', () => {
  it('expoe perfil canonico e mantem fallback legado fail-closed', () => {
    expect(migration).toContain('public.get_user_cedente_perfil_canonico()')
    expect(migration).toContain("ca.status = 'ATIVO'")
    expect(migration).toContain("RETURN 'ADMIN'")
    expect(migration).toContain('AND NOT EXISTS (')
  })

  it('remove policies owner-only e restringe mutacoes cadastrais ao ADMIN', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS cedentes_own_select')
    expect(migration).toContain('DROP POLICY IF EXISTS cedentes_own_update')
    expect(migration).toContain('private.usuario_e_admin_cedente(cedente_id)')
    expect(migration).toContain('DROP POLICY IF EXISTS storage_docs_cedente_insert')
    expect(aclMigration).toContain('FROM PUBLIC, anon')
    expect(aclMigration).toContain('TO authenticated, service_role')
  })

  it('ADMIN satisfaz operacional, mas o gate administrativo rejeita OPERACIONAL', () => {
    expect(authorization).toContain("export type CedenteAccessProfile = 'ADMIN' | 'OPERACIONAL'")
    expect(authorization).toContain("scope === 'administrativo' && perfil !== 'ADMIN'")
    expect(migration).toContain('SELECT private.usuario_tem_acesso_cedente(p_cedente_id);')
  })

  it('acoes societarias, bancarias e de estabelecimento usam gate administrativo', () => {
    expect(cedenteActions).toContain("requireCedenteOrganizationalAccess('administrativo')")
    expect(estabelecimentoActions.match(/cedenteAdministradorAutenticado\(\)/g)?.length).toBeGreaterThanOrEqual(4)
    expect(migration).toContain("'public.cadastrar_filial_cedente")
    expect(migration).toContain("'public.salvar_conta_estabelecimento_cedente")
  })

  it('extrato e logistica deixam de comparar o ator ao owner', () => {
    expect(escrow).not.toContain('row.cedentes.user_id')
    expect(migration).toContain('private.usuario_tem_acesso_cedente(c.id)')
    expect(migration).toContain("'public.registrar_documento_logistico_antecipado")
  })

  it('notificacoes excluem CONVIDADO/REVOGADO e nao duplicam owner canonico', () => {
    expect(notificacoes).toContain("acesso.status === 'ATIVO'")
    expect(notificacoes).toContain("escopo === 'operacional' || acesso.perfil === 'ADMIN'")
    expect(notificacoes).toContain('if (todasAssociacoes.length === 0)')
    expect(notificacoes).toContain('new Set(candidatos)')
    expect(notificationsMigration).toContain('private.notificar_cedente_ativos')
    expect(notificationsMigration).toContain("ca.status = 'ATIVO'")
    expect(notificationsMigration).toContain('NOT EXISTS (')
    expect(notificationsMigration).toContain("'public.processar_prazos_entrega(date)'")
    expect(notificationsMigration).toContain("'public.processar_aceite_sacado(uuid[],text,text)'")
  })

  it('gestao de usuarios aceita Gestor ou ADMIN e preserva MFA elevado', () => {
    expect(gestorActions).toContain('requireGestorOuAdminCedente')
    expect(gestorActions).toContain("requireCedenteOrganizationalAccess('administrativo'")
    expect(gestorActions).toContain('await exigirSessaoElevada(context)')
  })
})
