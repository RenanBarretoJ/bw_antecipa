import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260923160649_c3_consultor_cadastro_gestao_cedentes.sql',
  'utf8',
)
const c2Migration = readFileSync(
  'supabase/migrations/20260922214000_c2_consultor_criacao_operacao_cedente.sql',
  'utf8',
)
const c31GrantMigration = readFileSync(
  'supabase/migrations/20260923220357_c3_1_restaurar_select_solicitacoes_alteracao.sql',
  'utf8',
)
const action = readFileSync('src/lib/actions/consultor-cedentes.ts', 'utf8')
const loader = readFileSync('src/lib/consultor/cedentes.server.ts', 'utf8')
const form = readFileSync('src/components/consultor/novo-cedente-form.tsx', 'utf8')
const authorization = readFileSync('src/lib/auth/authorization.ts', 'utf8')

describe('C3 - Consultor cadastra e gere Cedentes vinculados a Fundo', () => {
  it('cria Cedente, vinculo com Fundo e vinculo com Consultor na mesma RPC', () => {
    const body = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.criar_cedente_consultor'),
      migration.indexOf('REVOKE ALL ON FUNCTION public.criar_cedente_consultor'),
    )

    expect(body).toContain('p_fundo_id uuid')
    expect(body).toContain('private.consultor_tem_acesso_fundo(p_fundo_id)')
    expect(body).toContain('INSERT INTO public.cedentes')
    expect(body).toContain("NULL, v_cnpj, v_razao_social, v_nome_fantasia")
    expect(body).toContain('INSERT INTO public.cedente_fundos')
    expect(body).toContain("v_cedente_id, p_fundo_id, 'ativo'")
    expect(body).toContain('INSERT INTO public.consultor_cedente')
    expect(body).toContain("v_actor_id, v_cedente_id, 0, 'pendente'")
    expect(body).toContain("'CEDENTE_CRIADO_POR_CONSULTOR'")
    expect(body).not.toContain('auth.users')
  })

  it('torna Fundo obrigatorio na interface e revalida no banco', () => {
    expect(form).toContain('<Label htmlFor="c3-fundo"')
    expect(form).toContain('name="fundoId" required')
    expect(action).toContain('p_fundo_id: parsed.data.fundoId')
    expect(migration).toContain("MESSAGE = 'Fundo nao autorizado para este Consultor.'")
    expect(migration).toContain('FROM public.usuario_fundos uf')
    expect(migration).toContain("uf.status = 'ativo'")
    expect(migration).toContain("consultor_id, fundo_id, 'operador', 'ativo'")
    expect(migration).toContain('ON CONFLICT (usuario_id, fundo_id) DO NOTHING')
  })

  it('separa gestao cadastral pendente da capacidade operacional do C2', () => {
    const manage = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION private.usuario_pode_gerenciar_cedente'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.usuario_pode_gerenciar_cedente'),
    )
    const operate = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION private.usuario_pode_operar_cedente'),
      migration.indexOf('REVOKE ALL ON FUNCTION private.usuario_pode_gerenciar_cedente'),
    )

    expect(manage).toContain("cc.status IN ('pendente', 'ativo')")
    expect(operate).toContain("c.status = 'ativo'::public.cedente_status")
    expect(operate).toContain('private.consultor_tem_acesso_cedente(c.id)')
    expect(c2Migration).toContain("cc.status = 'ativo'")
    expect(authorization).toContain("context.profile.role !== 'consultor' || !cedenteId")
    expect(authorization).toContain("rpc('usuario_pode_gerenciar_cedente'")
  })

  it('ativa o vinculo do Consultor apenas quando o Gestor aprova o Cedente', () => {
    const trigger = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION private.ativar_vinculo_consultor_c3_apos_aprovacao'),
      migration.indexOf('COMMIT;'),
    )

    expect(trigger).toContain("NEW.status = 'ativo'::public.cedente_status")
    expect(trigger).toContain("SET status = 'ativo'")
    expect(trigger).toContain("cc.status = 'pendente'")
    expect(trigger).toContain("'VINCULO_CONSULTOR_ATIVADO_APOS_APROVACAO'")
  })

  it('mantem carteira paginada server-side e busca por CNPJ ou nome', () => {
    expect(loader).toContain("rpc('listar_cedentes_gerenciados_consultor'")
    expect(loader).toContain('p_offset: (pagina - 1) * porPagina')
    expect(migration).toContain('count(*) OVER () AS total_count')
    expect(migration).toContain('extensions.unaccent')
    expect(migration).toContain("pg_catalog.regexp_replace(c.cnpj, '[^0-9]', '', 'g')")
  })

  it('protege dados e Storage pelo mesmo predicate can_manage', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS representantes_consultor_select')
    expect(migration).toContain('CREATE POLICY documentos_manager_select')
    expect(migration).toContain('CREATE POLICY documentos_manager_insert')
    expect(migration).toContain('CREATE POLICY documentos_manager_update')
    expect(migration).toContain('CREATE POLICY storage_docs_manager_insert')
    expect(migration).toContain("bucket_id = 'documentos-cedentes'")
    expect(migration).toContain('private.usuario_pode_gerenciar_cedente(c.id)')
    expect(migration).toContain('v_intent.usuario_id IS DISTINCT FROM v_actor_id')
    expect(migration).toContain('v_objeto.owner_id IS DISTINCT FROM v_actor_id::text')
  })

  it('permite ao Gestor ler solicitacoes de alteracao filtradas pela RLS', () => {
    expect(migration).toContain('CREATE POLICY solicitacoes_alteracao_cedente_manager_select')
    expect(c31GrantMigration).toContain(
      'GRANT SELECT ON TABLE public.solicitacoes_alteracao_cedente TO authenticated',
    )
    expect(c31GrantMigration).not.toContain('GRANT UPDATE')
    expect(c31GrantMigration).not.toContain('TO anon')
  })

  it('nao concede RPCs C3 ao perfil anonimo', () => {
    expect(migration).toContain('FROM PUBLIC, anon')
    const grants = migration.match(/GRANT EXECUTE[\s\S]*?;/giu) || []
    expect(grants.every((grant) => !/\bTO\s+anon\b/iu.test(grant))).toBe(true)
  })
})
